// plugins/jspsych-video-audio-keyboard-response.js
// Works with jsPsych v7 loaded via <script> tags (no ParameterType usage)

var jsPsychVideoAudioKeyboardResponse = (function () {

    const info = {
      name: "video-audio-keyboard-response",
      parameters: {
        video: { default: undefined },
        audio: { default: null },
        choices: { default: "NO_KEYS" },
        response_ends_trial: { default: false },
        trial_ends_after_audio: { default: true },
        trial_ends_after_video: { default: false },
        width: { default: null },
        height: { default: null }
      }
    };
  
    class Plugin {
      constructor(jsPsych) {
        this.jsPsych = jsPsych;
      }
  
      trial(display_element, trial) {
        let response = { rt: null, key: null };
        let keyboardListener = null;
  
        // ---- HTML ----
        let style = "";
        if (trial.width) style += `width:${trial.width}px;`;
        if (trial.height) style += `height:${trial.height}px;`;
  
        display_element.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;">
            <video id="mmo-video" playsinline style="${style}"></video>
            ${trial.audio ? `<audio id="mmo-audio"></audio>` : ``}
          </div>
        `;
  
        const videoEl = display_element.querySelector("#mmo-video");
        const audioEl = trial.audio ? display_element.querySelector("#mmo-audio") : null;
  
        // ---- VIDEO ----
        const videoSources = Array.isArray(trial.video) ? trial.video : [trial.video];
        videoEl.innerHTML = videoSources.map(src => `<source src="${src}" type="video/mp4">`).join("");
        videoEl.preload = "auto";
        videoEl.loop = true;
  
        // IMPORTANT: avoid autoplay blocks (audio is separate anyway)
        videoEl.muted = true;
  
        // ---- AUDIO ----
        if (audioEl) {
          audioEl.src = trial.audio;
          audioEl.preload = "auto";
        }
  
        const end_trial = () => {
          this.jsPsych.pluginAPI.clearAllTimeouts();
          if (keyboardListener) {
            this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);
          }
  
          try { videoEl.pause(); } catch(e) {}
          try { videoEl.currentTime = 0; } catch(e) {}
          if (audioEl) {
            try { audioEl.pause(); } catch(e) {}
            try { audioEl.currentTime = 0; } catch(e) {}
          }
  
          display_element.innerHTML = "";
  
          this.jsPsych.finishTrial({
            rt: response.rt,
            key: response.key,
            video: videoSources[0],
            audio: trial.audio ?? null
          });
        };
  
        // keyboard (optional)
        if (trial.choices !== "NO_KEYS") {
          keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
            callback_function: (info) => {
              response = info;
              if (trial.response_ends_trial) end_trial();
            },
            valid_responses: trial.choices,
            rt_method: "performance",
            persist: false,
            allow_held_key: false
          });
        }
  
        // end logic
        videoEl.onended = () => {
          if (trial.trial_ends_after_video) end_trial();
        };
  
        if (audioEl) {
          audioEl.onended = () => {
            if (trial.trial_ends_after_audio) end_trial();
          };
        }
  
        // errors -> end (so you don't get stuck)
        videoEl.onerror = () => end_trial();
        if (audioEl) audioEl.onerror = () => end_trial();
  
        // start both
        Promise.allSettled([
          videoEl.play(),
          audioEl ? audioEl.play() : Promise.resolve()
        ]);
  
        // safety fallback
        this.jsPsych.pluginAPI.setTimeout(() => end_trial(), 15000);
      }
    }
  
    Plugin.info = info;
    return Plugin;
  })();
  