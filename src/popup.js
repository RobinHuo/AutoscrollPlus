"use strict";

const settings = {
  speedIncrement: 10,
  autoStop: true,
};

// inject content script
getCurrentTab().then(tab =>
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/controller.js"]
  })
).then(() => sendMessage({ "action": "report" }));

getSettings(settings)
  .then(result => Object.assign(settings, result))
  .then(result => applySettings(result));

function applySettings(settings = settings) {
  document.getElementById("scroll-speed")
    .setAttribute("placeholder", settings.speedIncrement.toString());
}

// ========== UI Functionality ==========

// speed increment scroll buttons
const buttonSettings = {
  "scroll-up": [0, -1],
  "scroll-right": [1, 0],
  "scroll-down": [0, 1],
  "scroll-left": [-1, 0]
};
document.querySelectorAll(".scroll-button").forEach(button => {
  button.onclick = () => {
    sendMessage({
      "action": "changeSpeed",
      "args": {
        "deltaX": buttonSettings[button.id][0]
          * (document.getElementById("scroll-speed").value || settings.speedIncrement),
        "deltaY": buttonSettings[button.id][1]
          * (document.getElementById("scroll-speed").value || settings.speedIncrement),
      }
    });
  }
});

document.getElementById("scroll-speed").addEventListener("input", function(e) {
  sendMessage({
    "action": "setSpeedIncrement",
    "args": {
      "speedIncrement": e.currentTarget.value || settings.speedIncrement
    }
  })
});

document.getElementById("stop-button").onclick = () => {
  sendMessage({
    "action": "clearScroll"
  });
};

document.getElementById("pause-button").onclick = () => {
  sendMessage({
    "action": "pauseScroll"
  });
};

document.getElementById("resume-button").onclick = () => {
  sendMessage({
    "action": "resumeScroll"
  });
};

// handling controller state

let scrollState = null;

function cleanState(state) {
  return {
    mode: state.mode,
    x: state.x,
    y: state.y,
  };
}

function stateToString(state) {
  let str = "";
  if (state.mode === "smooth") {
    if (state.x.speed && state.y.speed) {
      str += `[${state.x.speed},${state.y.speed}] px/s`;
    } else if (state.x.speed) {
      str += `${state.x.speed} px/s `;
      str += state.x.speed > 0 ? "right" : "left";
    } else if (state.y.speed) {
      str += `${state.y.speed} px/s `;
      str += state.y.speed > 0 ? "down" : "up";
    }
  } else if (state.mode === "periodic") {
    if (state.x.interval && state.y.interval) {
      str += `[${state.x.increment},${state.y.increment}] px ` +
        `every [${state.x.interval},${state.y.interval}] ms`;
    } else if (state.x.interval) {
      str += `${state.x.increment} px `;
      str += state.x.increment > 0 ? "right" : "left";
      str += ` every ${state.x.interval} ms`;
    } else if (state.y.interval) {
      str += `${state.y.increment} px `;
      str += state.y.increment > 0 ? "down" : "up";
      str += ` every ${state.y.interval} ms`;
    }
  }
  return str;
}

function makeStatusMessage(state) {
  let message;
  if (state.isScrolling) {
    message = "Scrolling";
  } else if (state.mode === "smooth" && !state.x.speed && !state.y.speed ||
      state.mode === "periodic" && !state.x.interval && !state.y.interval) {
    return "Stopped";
  } else {
    message = "Paused";
  }
  message += ": ";
  message += stateToString(state);
  return message;
}

function updateScrollState(state) {
  scrollState = cleanState(state);
  document.getElementById("status-message").innerHTML = makeStatusMessage(state);
}

function stateHandler(message, sender, sendResponse) {
  if (message.type !== "state") return;
  updateScrollState(message.state);
}
chrome.runtime.onMessage.addListener(stateHandler);

// periodic scroll controls
document.getElementById("periodic-submit").onclick = () => {
  if (!document.getElementById("periodic-int").value) return;
  sendMessage({
    "action": "setPeriodicScroll",
    "args": {
      "xIncrement": Number(document.getElementById("periodic-x").value)
        * Number(document.getElementById("periodic-xdir").value),
      "yIncrement": Number(document.getElementById("periodic-y").value)
        * Number(document.getElementById("periodic-ydir").value),
      "interval": Number(document.getElementById("periodic-int").value)
        * Number(document.getElementById("periodic-unit").value)
    }
  });
};

// handling waypoints

function waypointHandler(message, sender, sendResponse) {
  if (message.type !== "waypoint") return;
  document.getElementById("waypoint-message").innerHTML =
    "Waypoint: " + (
      message.waypoint ? 
        message.waypoint[0] == null ?
          message.waypoint[1] === 0 ?
            "Top" :
          "Bottom" :
        `[${message.waypoint}]` :
      "None"
    );
  if (message.waypoint) {
    document.getElementById("waypoint-tab").checked = true;
  }
}
chrome.runtime.onMessage.addListener(waypointHandler);

document.getElementById("waypoint-click").onclick = () => {
  sendMessage({
    "action": "waypointFromClick"
  });
};

document.getElementById("waypoint-top").onclick = () => {
  sendMessage({
    "action": "setWaypoint",
    "args": {
      "waypoint": [null, 0]
    }
  });
};

document.getElementById("waypoint-bottom").onclick = () => {
  sendMessage({
    "action": "setWaypoint",
    "args": {
      "waypoint": [null, Number.MAX_SAFE_INTEGER]
    }
  });
};

document.getElementById("waypoint-submit").onclick = () => {
  sendMessage({
    "action": "scrollToWaypoint",
    "args": {
      // "waypoint": waypoint.map(n => n === null ? null :
      //   Math.min(Number.MAX_SAFE_INTEGER, n)),
      "time": Number(document.getElementById("waypoint-time").value)
    }
  })
};

// handling saving and loading

function updateSavedStateMessage(state) {
  document.getElementById("saved-message").innerHTML = "Saved: "
    + (state ? stateToString(state) : "None");
}
getCurrentURL().then(url => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!(url in changes) || areaName !== "local") return;
    updateSavedStateMessage(changes[url].newValue);
  });
  return getSavedState(url);
}).then(state => updateSavedStateMessage(state));


document.getElementById("save-button").onclick = async () => {
  if (!scrollState ||
    scrollState.mode === "smooth" && !scrollState.x.speed && !scrollState.y.speed ||
    scrollState.mode === "periodic" && !scrollState.x.interval && !scrollState.y.interval)
    return;
  const url = await getCurrentURL();
  await saveState(scrollState);
  console.log(`Saved state ${JSON.stringify(scrollState)} at ${url}`);
};

document.getElementById("load-button").onclick = async () => {
  const url = await getCurrentURL();
  const savedState = await getSavedState();
  sendMessage({
    "action": "loadProfile",
    "args": {
      "profile": savedState
    }
  });
  console.log(`Loaded state ${JSON.stringify(savedState)} from ${url}`);
};


// ========== Utility functions ==========

async function getCurrentTab() {
  return chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => tab);
}

async function sendMessage(message, options, callback) {
  return getCurrentTab()
    .then(tab => chrome.tabs.sendMessage(tab.id, message, options, callback));
}

async function getCurrentURL() {
  return normalizeURL((await getCurrentTab()).url);
}

async function saveState(state) {
  const url = await getCurrentURL();
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({[url]: state}, resolve);
    } catch (error) {
      reject(error);
    }
  });
}

async function getSavedState(url) {
  url = url ?? await getCurrentURL();
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get([url], result => resolve(result[url]));
    } catch (error) {
      reject(error);
    }
  });
}

async function getSettings(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get({settings: defaults}, function(result) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result.settings);
      }
    });
  });
}

function normalizeURL(url) {
  return new URL(url.replace(/#.*$/, "")).toString();
}
