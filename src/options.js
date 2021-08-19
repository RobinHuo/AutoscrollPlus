"use strict";

const defaults = {
  speedIncrement: 10,
  autoStop: true,
};

function populateOptions({ settings }) {
  document.querySelector("#speed-increment").value = settings.speedIncrement;
  document.querySelector("#auto-stop").checked = settings.autoStop;
}

chrome.storage.sync.get({
  settings: defaults
}, populateOptions);

document.querySelector("#save").onclick = function () {
 chrome.storage.sync.set({settings: {
   speedIncrement: document.querySelector("#speed-increment").value,
   autoStop: document.querySelector("#auto-stop").checked,
 }});
};

document.querySelector("#restore").onclick = () => populateOptions({settings: defaults});

document.querySelector("#delete").onclick = () => chrome.storage.local.clear();
