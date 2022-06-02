
/**
 * This file contains the main application logic and state.
 * All API requests regarding PTVs route optimization and geocoding happen here.
 */

const api_key = "YOUR_API_KEY";
const APIEndpoints = {
    SearchLocations: (searchText) => `https://api.myptv.com/geocoding/v1/locations/by-text?searchText=${searchText}`,
    CreatePlan: "https://api.myptv.com/routeoptimization/v1/plans",
    StartOptimization: (planId) => `https://api.myptv.com/routeoptimization/v1/plans/${planId}/operation/optimization?tweaksToObjective=IGNORE_MINIMIZATION_OF_NUMBER_OF_ROUTES`,
    GetOptimizationProgress: (planId) => `https://api.myptv.com/routeoptimization/v1/plans/${planId}/operation`,
    GetOptimizedPlan: (planId) => `https://api.myptv.com/routeoptimization/v1/plans/${planId}`,
    GetImageTiles: "https://api.myptv.com/rastermaps/v1/image-tiles/{z}/{x}/{y}?size={tileSize}&style=silica"
};

const applyHeaders = (configuration) => ({
     ...configuration,
     headers: {
        "apiKey": api_key,
        ...configuration ? { ...configuration.headers } : {}
    }
});

/**
 * This object represents the application state
 */
const appState = {
    actions: {
        pickup: undefined,
        delivery: undefined,
        pickupAndDeliveries: []
    },
    locations: [],
    transports: [],
    optimizedPlan: undefined,
    selectedVehicleIndex: 0
};

const ServiceTypes = {
    Pickup: "pickup",
    Delivery: "delivery"
};

/**
 * Applications entry point, triggered by "window.onload" event
 */
const initializeApplication = () => {
    initialzeMap();

    getElement("pickup-location").addEventListener("input", debounce((event) => findLocationsByText(event, ServiceTypes.Pickup), 250));
    getElement("delivery-location").addEventListener("input", debounce((event) => findLocationsByText(event, ServiceTypes.Delivery), 250));
    getElement("btn-add-transport").addEventListener("click", addTransport);
    getElement("btn-start-optimization").addEventListener("click", optimizeTransports);
    getElement("previous-vehicle").addEventListener("click", () => switchSelectedVehicle(-1));
    getElement("next-vehicle").addEventListener("click", () => switchSelectedVehicle(1));
    getElement("close-error-details").addEventListener("click", () => hideElement("error-log"));
    getElement("clear-transports").addEventListener("click", () => clearSpecifiedTransports());
    window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
};

const createOptimizationPlan = () => {
    const vehicles = [];
    const numberOfVehicles = getElement("number-of-vehicles").value;
    const vehicleProfileSelection = getElement("vehicle-profile");
    const vehicleProfile = vehicleProfileSelection.options[vehicleProfileSelection.selectedIndex].value;

    for (let i = 1; i <= numberOfVehicles; i++) {
        vehicles.push({
            id: "Vehicle " + i,
            profile: vehicleProfile
        });
    }

    const planToBeOptimized = {
        locations: appState.locations,
        transports: appState.transports,
        vehicles
    };

    return fetch(
                APIEndpoints.CreatePlan,
                applyHeaders({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(planToBeOptimized)
                })
            ).then(response => response.ok ? response.json() : logError(response))
};

const startOptimization = (planId) =>
    fetch(
        APIEndpoints.StartOptimization(planId),
        applyHeaders({
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        })
    ).then(response => response.ok ? true : logError(response));

const getOptimizationProgress = (planId) =>
    fetch(
        APIEndpoints.GetOptimizationProgress(planId),
        applyHeaders()
    ).then(response => response.ok ? response.json() : logError(response));

const getOptimizedPlan = (planId) =>
    fetch(
        APIEndpoints.GetOptimizedPlan(planId),
        applyHeaders()
    ).then(response => response.ok ? response.json() : logError(response));

const findLocationsByText = (inputEvent, serviceType) => {
    const { id, value } = inputEvent.target;

    if (!value) {
        appState.actions[serviceType] = undefined;
        disableElement("btn-add-transport");
        return;
    }

    fetch(
        APIEndpoints.SearchLocations(value),
        applyHeaders()
    ).then(
        response => response.json()
    ).then(({locations}) => {
        const suggestionsList = getElement(id + "-suggestions");
        removeAllChildNodes(suggestionsList);

        locations.forEach(location => {
            const suggestion = document.createElement("li");
            suggestion.innerText = `${location.formattedAddress}, ${location.address.countryName}`;
            suggestion.addEventListener("click", () => selectLocationSuggestion(location, id, serviceType));
            suggestionsList.appendChild(suggestion);
        });

        showElement(id + "-suggestions");
    });
};

const optimizeTransports = async () => {
    showElement("processing-indicator", "flex");

    const plan = await createOptimizationPlan();
    if (!plan) return;

    const startSuccessful = await startOptimization(plan.id);
    if (!startSuccessful) return;

    const interval = setInterval( async () => {
        const progress = await getOptimizationProgress(plan.id);
        if (!progress) return clearInterval(interval);

        if (progress.status === "SUCCEEDED") {
            clearInterval(interval);
            const optimizedPlan = await getOptimizedPlan(plan.id);
            if (!optimizedPlan) return;
            appState.optimizedPlan = optimizedPlan;
            populateRouteDetails();
            populateKPIs();
            drawRoutes();
            showElement("optimization-results", "flex");
            hideElement("processing-indicator");
            hideElement("hint-1");
            hideElement("hint-2");
        }
    }, 500);
};

const selectLocationSuggestion  = (location, inputElementId, serviceType) => {
    getElement(inputElementId).value = `${location.formattedAddress}, ${location.address.countryName}`;
    hideElement(inputElementId + "-suggestions");

    appState.actions[serviceType] = location;

    const { latitude, longitude } = { ...location.referencePosition };
    addTentativeMarkerToMap(latitude, longitude, serviceType);

    if (appState.actions.pickup && appState.actions.delivery) enableElement("btn-add-transport");
}

const getOpeningTimes = (isPickup) => {
    const openingFromValue = isPickup ?  getElement("pickup-from").value : getElement("delivery-from").value;
    const openingToValue = isPickup ?  getElement("pickup-to").value : getElement("delivery-to").value;

    const [hoursFrom, minutesFrom] = openingFromValue.split(":").map(value => Number(value));
    const [hoursTo, minutesTo] = openingToValue.split(":").map(value => Number(value));

    return {
        from: [hoursFrom, minutesFrom],
        to: [hoursTo, minutesTo]
    }
};

const mapToLocation = (location, serviceType) => {
    const isPickup = serviceType === ServiceTypes.Pickup;
    const id = (isPickup ? "P" : "D") + (appState.transports.length + 1);
    const { latitude, longitude } = { ...location.referencePosition };

    const { from, to } = getOpeningTimes(isPickup);

    const start = new Date();
    start.setHours(from[0], from[1], 0, 0);

    const end = new Date();
    end.setHours(to[0], to [1], 0, 0);

    return {
        id,
        type: "CUSTOMER",
        latitude,
        longitude,
        openingIntervals: [{
            start: start.toISOString(),
            end: end.toISOString()
        }]
    };
};

const createNewTransport = (pickupLocationId, deliveryLocationId) => {
    const pickupServiceTimeSeconds = getElement("pickup-service-time").value * 60;
    const deliveryServiceTimeSeconds = getElement("delivery-service-time").value * 60;

    return {
        id: `Transport-${pickupLocationId}-${deliveryLocationId}`,
        pickupLocationId,
        pickupServiceTime: pickupServiceTimeSeconds,
        deliveryLocationId,
        deliveryServiceTime: deliveryServiceTimeSeconds
    }
};

const addTransport = () => {
    const { pickup, delivery } = appState.actions;
    const pickupLocation = mapToLocation(pickup, ServiceTypes.Pickup);
    const deliveryLocation = mapToLocation(delivery, ServiceTypes.Delivery);

    appState.actions.pickupAndDeliveries.push({ id: pickupLocation.id, ...pickup }, { id: deliveryLocation.id, ...delivery });
    appState.locations.push(pickupLocation);
    appState.locations.push(deliveryLocation);

    const newTransport = createNewTransport(pickupLocation.id, deliveryLocation.id);
    appState.transports.push(newTransport);

    updateTransportsOverviewTable(newTransport);

    clearTentativeMarkers();
    addMarkerToMap(pickupLocation.latitude, pickupLocation.longitude);
    addMarkerToMap(deliveryLocation.latitude, deliveryLocation.longitude);

    appState.actions.pickup = undefined;
    appState.actions.delivery = undefined;

    disableElement("btn-add-transport");
    enableElement("btn-start-optimization");
    showElement("hint-1");
    showElement("hint-2");

    getElement("pickup-location").value = "";
    getElement("delivery-location").value = "";
};

const clearSpecifiedTransports = () => {
    appState.transports = [];
    appState.locations = [];
    appState.actions.pickupAndDeliveries = [];
    appState.selectedVehicleIndex = 0;

    clearAllMarkers();
    hideElement("optimization-results");

    removeAllChildNodes(getElement("transports-overview").getElementsByTagName("tbody")[0]);
    disableElement("btn-start-optimization");
};

const updateTransportsOverviewTable = (transport) => {
    const tbody = getElement("transports-overview").getElementsByTagName("tbody")[0];
    const row = tbody.insertRow();
    row.insertCell(0).innerText = transport.id;
    row.insertCell(1).innerText = lookupLocation(transport.pickupLocationId).formattedAddress;
    row.insertCell(2).innerText = lookupLocation(transport.deliveryLocationId).formattedAddress;
};

const switchSelectedVehicle = (step) => {
    const { selectedVehicleIndex } = appState;
    const { vehicles, unplannedVehicleIds } = appState.optimizedPlan;
    const usedVehicles = vehicles.filter(vehicle => !unplannedVehicleIds.includes(vehicle.id));

    let newIndex = selectedVehicleIndex + step;
    if (newIndex < 0) newIndex = usedVehicles.length - 1;
    if (newIndex > usedVehicles.length - 1) newIndex = 0;

    appState.selectedVehicleIndex = newIndex;
    populateRouteDetails(newIndex);
};

const populateRouteDetails = (vehicleIndex = 0) => {
    const { vehicles, routes, unplannedVehicleIds } = appState.optimizedPlan;

    const usedVehicles = vehicles.filter(vehicle => !unplannedVehicleIds.includes(vehicle.id));
    if (!usedVehicles[vehicleIndex]) return;

    const vehicleId = usedVehicles[vehicleIndex].id;
    const route = routes.find(route => route.vehicleId === vehicleId);

    getElement("vehicle-id").innerText = vehicleId;

    const table = getElement("route-details");
    const tbody = table.getElementsByTagName("tbody")[0];
    removeAllChildNodes(tbody);

    route.stops.forEach((stop, index) => {
        const row = tbody.insertRow();
        const numberCell = row.insertCell(0);
        const stopCell = row.insertCell(1);
        const eventCell = row.insertCell(2);
        const arrivalTimeCell = row.insertCell(3);

        numberCell.innerText = index + 1;
        stopCell.innerText = lookupLocation(stop.locationId).formattedAddress;
        eventCell.innerText = stop.deliveryIds.length > 0 ? "Delivery" : "Pickup";
        arrivalTimeCell.innerText = new Date(stop.reportForStop.arrivalTime).toLocaleTimeString();
    });

    getElement("vehicle-travel-distance").innerText = formatMetersToKilometers(route.report.distance);
    getElement("vehicle-travel-time").innerText = formatSecondsToHHMM(route.report.travelTime);
};

const drawRoutes = () => {
    clearAllLines();
    const { locations, routes } = appState.optimizedPlan;
    routes.forEach(route => {
        const locationIds = route.stops.map(stop => stop.locationId);
        const coordinates = locationIds.map(locationId => {
            const location = locations.find(location => location.id === locationId)
            return [location.latitude, location.longitude];
        });
        addPolylineToMap(coordinates);
    });
};

const populateKPIs = () => {
    const { routes, transports, unplannedTransportIds, vehicles, unplannedVehicleIds } = appState.optimizedPlan;
    const totalTravelTime = routes.reduce((sum, route) => sum + route.report.travelTime, 0);
    const totalDrivingTime = routes.reduce((sum, route) => sum + route.report.drivingTime, 0);
    const totalDistance = routes.reduce((sum, route) => sum + route.report.distance, 0);
    const totalBreakTime = routes.reduce((sum, route) => sum + route.report.breakTime, 0);
    const totalRestTime = routes.reduce((sum, route) => sum + route.report.restTime, 0);
    const totalWaitingTime = routes.reduce((sum, route) => sum + route.report.waitingTime, 0);

    getElement("used-vehicles").innerText = vehicles.length - unplannedVehicleIds.length;
    getElement("unused-vehicles").innerText = unplannedVehicleIds.length;
    getElement("planned-transports").innerText = transports.length - unplannedTransportIds.length;
    getElement("unplanned-transports").innerText = unplannedTransportIds.length;
    getElement("total-travel-time").innerText = formatSecondsToHHMM(totalTravelTime);
    getElement("total-driving-time").innerText = formatSecondsToHHMM(totalDrivingTime);
    getElement("total-travel-distance").innerText = formatMetersToKilometers(totalDistance);
    getElement("total-break-time").innerText = formatSecondsToHHMM(totalBreakTime);
    getElement("total-rest-time").innerText = formatSecondsToHHMM(totalRestTime);
    getElement("total-waiting-time").innerText = formatSecondsToHHMM(totalWaitingTime);
};

const logError = async (response) => {
    const errorDetails = await response.json();
    getElement("error-details").innerHTML = JSON.stringify(errorDetails, null, 2);
    showElement("error-log");
    hideElement("processing-indicator");
    return false;
};

window.onload = initializeApplication;