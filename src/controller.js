(function() {
  "use strict";

  // Include guard
  if (window.autoscrollInjected) return;
  else {
    window.autoscrollInjected = true;

    // first-time document setup below

    // add custom style (waypoint selection cursor)
    const customStyle = document.createElement("style");
    customStyle.innerHTML = 
      `.autoscroll-selected {
        cursor: crosshair !important;
      }
      
      .autoscroll-selected * {
        cursor: inherit !important;
      }`;
    document.head.appendChild(customStyle);
  }

  const settings = {
    speedIncrement: 10,
    autoStop: true,
  };
  chrome.storage.sync.get({settings: settings}, function(result) {
    if (chrome.runtime.lastError) {
      console.error("Failed to load settings");
    } else {
      Object.assign(settings, result.settings);
    }
  });


  // TODO: preserve isFinished when pausing


  // ========== CONSTANTS ==========

  const SPEED_MS = 1000;  // 1 speed unit = 1 px / SPEED_MS ms
  // TODO: move this to settings
  const MIN_INTERVAL = 5;


  // ========== FUNCTIONS ==========

  function vecAdd(a, b) {
    let [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
    return longer.map((value, index) => {
      return value + (shorter[index] || 0);
    });
  }

  function vecMultiply(a, b) {
    let [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
    return longer.map((value, index) => {
      return value * (shorter[index] || 0);
    });
  }


  // ========== CLASSES ==========

  class AbstractScrollDimension {

    constructor(name, basis) {
      if (new.target === AbstractScrollDimension) {
        throw new TypeError("Cannot instantiate abstract class AbstractScrollDimension");
      }
      this.name = name;
      this.basis = basis;
      this.timerID = null;
    }

    calcIntervalIncrement(speed) {
      let increment = speed / Math.abs(speed);
      let interval = SPEED_MS / Math.abs(speed);
      let multiplier = Math.max(1, Math.ceil(MIN_INTERVAL / interval));
      return [interval * multiplier, increment * multiplier];
    }

  }

  class PeriodicScrollDimension extends AbstractScrollDimension {

    static from(scrollDimension) {
      const { name, basis, timerID, interval, increment } = scrollDimension;
      const result = new PeriodicScrollDimension(name, basis);
      result.timerID = timerID;
      result.interval = interval;
      result.increment = increment;
      return result;
    }

    constructor(name, basis) {
      super(name, basis);
      this.interval = Infinity;
      this.increment = 0;
    }

    get speed() {
      return SPEED_MS * this.increment / this.interval;
    }

    set speed(value) {
      if (value) {
        [this.interval, this.increment] = this.calcIntervalIncrement(value);
      } else {
        this.interval = Infinity;
        this.increment = 0;
      }
    }

  }


  class SmoothScrollDimension extends AbstractScrollDimension {

    static from(scrollDimension) {
      const { name, basis, timerID, speed } = scrollDimension;
      const result = new SmoothScrollDimension(name, basis);
      result.timerID = timerID;
      result.speed = speed;
      return result;
    }

    constructor(name, basis) {
      super(name, basis);
      this._speed = 0;
      this._increment = 0;
      this._interval = Infinity;
    }

    get speed() {
      return this._speed;
    }

    set speed(value) {
      this._speed = value;
      if (value) {
        [this._interval, this._increment] = this.calcIntervalIncrement(value);
      } else {
        this._interval = Infinity;
        this._increment = 0;
      }
    }

    get interval() {
      return this._interval;
    }

    get increment() {
      return this._increment;
    }

  }


  class ScrollController {

    constructor(scrollElement) {
      this.scrollElement = scrollElement || document.scrollingElement;
      this.x = new SmoothScrollDimension("x", [1, 0]);
      this.y = new SmoothScrollDimension("y", [0, 1]);
    }

    get velocity() {
      return [this.x.speed, this.y.speed];
    }

    set velocity(value) {
      [this.x.speed, this.y.speed] = value;
    }

    get isScrolling() {
      return Boolean(this.x.timerID || this.y.timerID);
    }

    set isScrolling(value) {
      if (value) this.startScroll();
      else this.stopScroll();
    }

    toSmooth() {
      if ([this.x, this.y].every(d => d instanceof SmoothScrollDimension))
        return;
      this.x = SmoothScrollDimension.from(this.x);
      this.y = SmoothScrollDimension.from(this.y);
    }

    toPeriodic() {
      if ([this.x, this.y].every(d => d instanceof PeriodicScrollDimension))
        return;
      this.x = PeriodicScrollDimension.from(this.x);
      this.y = PeriodicScrollDimension.from(this.y);
    }

    getScrollMode() {
      if ([this.x, this.y].every(d => d instanceof SmoothScrollDimension)) {
        return "smooth";
      } else if ([this.x, this.y].every(d => d instanceof PeriodicScrollDimension)) {
        return "periodic";
      } else {
        throw new Error("Invalid scroll mode");
      }
    }

    scroll(increment, isFinished, dimensionName) {
      if (dimensionName) {
        increment = vecMultiply(increment, this[dimensionName].basis);
      }
      this.scrollElement.scrollBy(...increment);

      const hit = settings.autoStop && this.hasHitBoundary(dimensionName);
      if (hit || isFinished?.()) {
        this.stopScroll(false, dimensionName);
        if (hit && hit !== true) {
          this[dimensionName ?? hit].speed = 0;
          this.updateScroll(isFinished);
        }
      }
    }
  
    startScroll(isFinished) {
      if (this.isScrolling) return;
      let args = [[this.x.increment, this.y.increment], isFinished];
      if (this.x.interval === this.y.interval) {
        if (this.x.interval === Infinity) return;
        // put both dimensions under the same timer
        this.x.timerID = this.y.timerID = setInterval((args) => {
          this.scroll(...args);
        }, this.x.interval, args);
      } else {
        // dimensions are out of sync, use separate timers
        [this.x, this.y].forEach(dimension => {
          if (dimension.speed) {
            dimension.timerID = setInterval((args) => {
              this.scroll(...args, dimension.name);
            }, dimension.interval, args);
          }
        })
      }
      this.reportState();
      // console.log(`Scrolling [${[this.x.increment, this.y.increment]}] px ` +
      //   `every [${[this.x.interval, this.y.interval]}] ms`);
    }
  
    stopScroll(reset, dimensionName, report = true) {
      let toStop = dimensionName ? [this[dimensionName]] : [this.x, this.y];
      toStop.forEach(dimension => {
        if (dimension.timerID) {
          clearInterval(dimension.timerID);
          dimension.timerID = null;
        }
        if (reset && dimension.speed) {
          dimension.speed = 0;
          // console.log(`Stopped scrolling dimension ${dimension.name}`);
        }
      });
      if (report) this.reportState();
    }

    updateScroll(isFinished) {
      let isZero = this.velocity.every(num => num === 0);
      if (this.isScrolling) {
        this.stopScroll(isZero, undefined, isZero);
      }
      if (!isZero) {
        this.startScroll(isFinished);
      }
    }

    getState() {
      const mode = this.getScrollMode();
      const state = {
        isScrolling: this.isScrolling,
        mode: mode
      };
      if (mode === "smooth") {
        Object.assign(state, {
          x: {
            speed: this.x.speed
          },
          y: {
            speed: this.y.speed
          }
        });
      } else if (mode === "periodic") {
        Object.assign(state, {
          x: {
            interval: this.x.interval,
            increment: this.x.increment
          },
          y: {
            interval: this.y.interval,
            increment: this.y.increment
          }
        });
      }
      return state;
    }

    setState(state, report = true) {
      if (state.mode === "smooth") {
        this.toSmooth();
      } else if (state.mode === "periodic") {
        this.toPeriodic();
      }
      ["x", "y"].forEach(dim => Object.assign(this[dim], state[dim]));
      if (report) this.reportState();
    }

    reportState(state = this.getState()) {
      chrome.runtime.sendMessage({ "type": "state", "state": state });
    }

    hasHitBoundary(dimensionName) {
      const [speedX, speedY] = this.velocity;
      const {
        scrollWidth,
        scrollHeight,
        scrollLeft,
        scrollTop,
        clientWidth,
        clientHeight
      } = this.scrollElement;

      const hitX = speedX < 0 && scrollLeft <= Math.min(scrollWidth, 0) ||
        speedX > 0 && scrollLeft + clientWidth >= Math.max(scrollWidth, 0);
      const hitY = speedY < 0 && scrollTop <= Math.min(scrollHeight, 0) ||
        speedY > 0 && scrollTop + clientHeight >= Math.max(scrollHeight, 0);

      if (dimensionName === "x")
        return hitX;
      else if (dimensionName === "y")
        return hitY;
      else if (hitX && hitY)
        return true;
      else if (hitX)
        return "x";
      else if (hitY)
        return "y";
      else
        return false;
    }
  }


  // ========== INTERACTION HANDLING ==========

  let controller = new ScrollController();
  let storedWaypoint = null;
  let storedSpeedIncrement = settings.speedIncrement;

  const actions = {

    report() {
      controller.reportState();
      chrome.runtime.sendMessage({
        "type": "waypoint",
        "waypoint": storedWaypoint
      });
    },

    changeSpeed({ deltaX, deltaY }) {
      controller.toSmooth();
      controller.velocity = vecAdd(controller.velocity, [deltaX, deltaY]);
      controller.updateScroll();
    },

    setSpeed({ speedX, speedY }) {
      controller.toSmooth();
      controller.velocity = [speedX, speedY];
      controller.updateScroll();
    },

    clearScroll() {
      controller.stopScroll(true);
    },

    pauseScroll() {
      controller.stopScroll(false);
    },

    resumeScroll() {
      controller.startScroll();
    },

    setPeriodicScroll({ xIncrement, yIncrement, interval }) {
      controller.stopScroll(true);
      controller.toPeriodic();
      controller.x.increment = xIncrement;
      controller.y.increment = yIncrement;
      if (xIncrement) controller.x.interval = interval;
      if (yIncrement) controller.y.interval = interval;
      controller.updateScroll();
    },

    loadProfile({ profile }) {
      controller.stopScroll(true);
      controller.setState(profile);
    },

    scrollToWaypoint({ waypoint = storedWaypoint, time }) {
      controller.toSmooth();

      const {
        scrollWidth,
        scrollHeight,
        scrollLeft,
        scrollTop,
        clientWidth,
        clientHeight
      } = controller.scrollElement;

      let x;
      if (waypoint[0] < 0)
        x = 0;
      else if (waypoint[0] > scrollWidth)
        x = scrollWidth;
      else
        x = waypoint[0];

      let y;
      if (waypoint[1] < 0)
        y = 0;
      else if (waypoint[1] > scrollHeight)
        y = scrollHeight;
      else
        y = waypoint[1];
      
      let deltaX;
      if (waypoint[0] === null)
        deltaX = 0;
      else
        deltaX = x - scrollLeft;
      if (x > scrollLeft + clientWidth)
        deltaX -= clientWidth;
      
      let deltaY;
      if (waypoint[1] === null)
        deltaY = 0;
      else
        deltaY = y - scrollTop;
      if (y > scrollTop + clientHeight)
        deltaY -= clientHeight;

      if (!time) {
        controller.scrollElement.scrollBy(deltaX, deltaY);
      } else {
        let speed = [deltaX, deltaY].map(dist => dist / time);
        controller.velocity = speed;
        controller.updateScroll(() =>
          controller.scrollElement.scrollLeft <= x &&
          x <= controller.scrollElement.scrollLeft
            + controller.scrollElement.clientWidth &&
          controller.scrollElement.scrollTop <= y &&
          y <= controller.scrollElement.scrollTop
            + controller.scrollElement.clientHeight
        );
      }
    },

    waypointFromClick() {
      controller.scrollElement.classList.add("autoscroll-selected");
      controller.scrollElement.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        controller.scrollElement.classList.remove("autoscroll-selected");
        const rect = controller.scrollElement.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        storedWaypoint = [x, y];
        chrome.runtime.sendMessage({
          "type": "waypoint",
          "waypoint": [x, y]
        });
      }, { capture: true, once: true, passive: false });
    },

    setWaypoint({ waypoint }) {
      storedWaypoint = waypoint;
      chrome.runtime.sendMessage({
        "type": "waypoint",
        "waypoint": storedWaypoint
      });
    },

    setSpeedIncrement({ speedIncrement }) {
      storedSpeedIncrement = speedIncrement;
    },

  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message.action) {
      console.error("Invalid message received");
      return;
    }
    actions[message.action](message.args);
  });

  // hotkeys
  controller.scrollElement.addEventListener("keydown", function (e) {
    if (e.code === "Space") {
      if (controller.isScrolling) {
        actions.pauseScroll();
      } else {
        actions.resumeScroll();
      }
    } else if (e.code === "Backspace") {
      actions.clearScroll();
    } else if (e.code.startsWith("Arrow")) {
      let delta = {
        "ArrowLeft": [-1, 0],
        "ArrowRight": [1, 0],
        "ArrowUp": [0, -1],
        "ArrowDown": [0, 1],
      }[e.code];
      delta = vecMultiply(delta, [storedSpeedIncrement, storedSpeedIncrement]);
      actions.changeSpeed({ deltaX: delta[0], deltaY: delta[1] });
    } else {
      return;
    }
    e.preventDefault();
  }, { passive: false });

})();
