/**
 * This file contains general helper functions, for a convenient way
 * of manipulating DOM elements and value formatting.
 */

const getElement = (id) => document.getElementById(id);

const showElement = (id, displayMode) => getElement(id).style.display = !displayMode ? "block" : displayMode;

const hideElement = (id) => getElement(id).style.display = "none";

const enableElement = (id) => getElement(id).disabled = false;

const disableElement = (id) => getElement(id).disabled = true;

const removeAllChildNodes = (parent) => {
    while (parent.firstChild) {
        parent.removeChild(parent.firstChild);
    }
};

const debounce = (callback, wait) => {
    let timeoutId = null;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            callback.apply(null, args);
        }, wait);
    };
};

const formatMetersToKilometers = (valueInMeters) => `${valueInMeters / 1000} km`;

const formatSecondsToHHMM = (valueInSeconds) => {
    let hours = Math.floor(valueInSeconds / 3600);
    let minutes = Math.floor((valueInSeconds - (hours * 3600)) / 60);

    if (hours < 10) hours = "0" + hours;
    if (minutes < 10) minutes = "0" + minutes;
    
    return `${hours} h ${minutes} min`;
};

const lookupLocation = (id) => appState.actions.pickupAndDeliveries.find(location => location.id === id);