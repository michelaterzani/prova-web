// main.js — MathOMeter FULL (6 run x 20 trial) PTB-LIKE onsets + 1 file PER RUN
// Struttura: SubjectID -> press any key (TTLonset) -> Loader -> Builder -> trials
// Salvataggio: mathometer_<subject>_run_<runNumber>_ptb_like.json alla fine di OGNI run
//
// PTB-like timing/log:
// questions.onsets(trial,:) = [beepFlip, sentenceStart, respFlip, feedbackStart, restFlipStart, restFlipEnd]
// col1/3/5/6 = "Flip-based"  -> browser: requestAnimationFrame timestamp (flip-like)
// col2/4     = "GetSecs-based" -> browser: performance.now timestamp
//
// Response window: 4s from respFlip (onset(3)), like PTB: respEnd = vblRespStart + 4
//
// IMPORTANT STABILITY FIXES:
// - Freeze trial index as `trialRow` and use it inside ALL async callbacks (ended, rAF).
// - Do NOT delay video loop/listener setup inside rAF; rAF is only for the timestamp.
// - WAIT duration fixed at 4s (no deadline/remaining logic).

let MMO_BEEP_T0_MS = null;

const timing = {
  fixationDuration: 1.0,
  responseDuration: 4.0,      // PTB: timing.respDuration = 4
  feedbackDuration: 1.5,
  restDuration: 5.0,
  beepDuration: 0.5
};

// Characters
const CHARACTER_IDS = ["P1", "P2", "P3", "P4"];
const CHARACTER_GENDER = { P1: "M", P2: "F", P3: "M", P4: "F" };

const TOTAL_RUNS = 6;
const NUM_SENTENCES = 20;

// ====== PTB-LIKE STATE ======
let MMO_TTL_T0_MS = null;

// (puoi anche eliminarlo, ma lo lascio per debug)
let MMO_TRIAL_I = 0;          // 0..19 dentro run (solo informativo)
let MMO_RUN_QUESTIONS = null; // buffer run corrente (20 trial)

// Response capture state (PTB-like "KbQueue firstPress")
let MMO_WAIT_START_MS = null;     // respFlip absolute time (ms)
let MMO_FIRST_PRESS_MS = null;    // first press absolute time (ms)
let MMO_FIRST_KEY = null;         // 'b' or 'y'
let MMO_GOT_RESP = false;         // true if first press captured

function newRunQuestions() {
  return {
    onsets: [],          // [trial][6]
    response: [],        // "True"/"False"/"NA"
    rt: [],              // pressTime - TTL (s) or -1
    sentenceNames: [],
    truthValue: [],
    type: [],
    _gotResp: []         // helper internal (not PTB original)
  };
}

function relToTTL_s(t_ms) {
  return (MMO_TTL_T0_MS == null) ? null : (t_ms - MMO_TTL_T0_MS) / 1000;
}

// Flip-based stamp: closest browser equivalent to Screen('Flip') timestamp
function stampFlip(cb) {
  requestAnimationFrame(() => cb(performance.now()));
}

function keyToSide(key) {
  if (key === "b") return "right";
  if (key === "y") return "left";
  return null;
}

// trueSide: 1 TRUE a destra (b), 2 TRUE a sinistra (y)
function keyToTrueFalse(key, trueSide) {
  const side = keyToSide(key);
  if (!side) return "NA";
  if (trueSide === 1) return (side === "right") ? "True" : "False";
  return (side === "left") ? "True" : "False";
}

function mappingString(trueSide) {
  return (trueSide === 1)
    ? "True=right(b), False=left(y)"
    : "True=left(y), False=right(b)";
}

// ====== DEBUG LABEL ======
function setDebugLabel(text) {
  const root = document.querySelector("#jspsych-content");
  if (!root) return;
  let el = root.querySelector(".mmo-debug-label");
  if (!el) {
    el = document.createElement("div");
    el.className = "mmo-debug-label";
    root.appendChild(el);
  }
  el.textContent = text;
}

function clearDebugLabel() {
  const root = document.querySelector("#jspsych-content");
  if (!root) return;
  const el = root.querySelector(".mmo-debug-label");
  if (el) el.remove();
}

function fixationHTML() {
  return `<div class="mmo-fixation">+</div>`;
}

// ====== UTILS ======
async function loadJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Errore caricando ${path}: ${resp.status}`);
  return await resp.json();
}

function randomPermutation(n) {
  const arr = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ====== PREPARE SUBJECT ======
function prepareSubject(subjectId, subjectNumber, allSentences, assoc) {
  const N_CHARACTERS = CHARACTER_IDS.length;

  // Ordine run come PTB: 1..6
  const runOrder = Array.from({ length: TOTAL_RUNS }, (_, i) => i + 1);

  const runs = [];

  for (let i = 0; i < TOTAL_RUNS; i++) {
    const runNumber = runOrder[i];

    const sentencesThisRun = allSentences.filter(s => Number(s.run) === Number(runNumber));
    if (sentencesThisRun.length < 1) throw new Error(`Run ${runNumber}: nessuna frase trovata nel JSON`);

    const sentOrder = randomPermutation(sentencesThisRun.length);
    const orderedSentences = sentOrder.map(idx => sentencesThisRun[idx]).slice(0, NUM_SENTENCES);

    const charAssoc = assoc.find(r => Number(r.run) === Number(runNumber));
    if (!charAssoc) throw new Error(`Nessuna SentenceCharacterAssociation per run ${runNumber}`);

    const charList = charAssoc.characters;
    const shift = subjectNumber % N_CHARACTERS;

    const thisRunChars = orderedSentences.map((_, idx) => {
      const j = (idx + shift) % charList.length;
      return charList[j];
    });

    let trueSide;
    if (i === 0) trueSide = Math.random() < 0.5 ? 1 : 2;
    else trueSide = 3 - runs[i - 1].trueSide;

    const trials = [];
    for (let t = 0; t < orderedSentences.length; t++) {
      const s = orderedSentences[t];
      const characterId = thisRunChars[t];
      const gender = CHARACTER_GENDER[characterId];
      const cIndex = CHARACTER_IDS.indexOf(characterId) + 1;

      const sentenceFileName =
        `Sentence${s.sentenceId}_${s.category}_${s.theme}_${s.truthValue}_Gender_${gender}.wav`;

      const sentAnimName = trueSide === 1 ? "SentenceTrueRight" : "SentenceTrueLeft";
      const waitAnimName = trueSide === 1 ? "WaitTrueRight" : "WaitTrueLeft";

      trials.push({
        run: runNumber,
        trialIndex: t + 1, // 1..20
        trueSide,
        subjectId,
        subjectNumber,

        sentenceId: s.sentenceId,
        category: s.category,
        theme: s.theme,
        truthValue: s.truthValue,

        characterId,
        gender,

        audioFile: `Sentences/${sentenceFileName}`,
        animSentenceFile: `Animations/${sentAnimName}P${cIndex}.mp4`,
        animWaitFile: `Animations/${waitAnimName}P${cIndex}.mp4`,

        robotOk: `Animations/FeedbackOkRobot.mp4`,
        robotNotOk: `Animations/FeedbackNotokRobot.mp4`,

        beep: `Sentences/beep.wav`,
      });
    }

    runs.push({ runNumber, trueSide, trials });
  }

  return { subjectId, subjectNumber, runs, currentRun: 1 };
}

// ====== PLUGIN: Loader ======
var jsPsychMmoLoader = (function () {
  const info = { name: "mmo-loader", parameters: {} };

  class Plugin {
    constructor(jsPsych) { this.jsPsych = jsPsych; }

    trial(display_element, trial) {
      display_element.innerHTML = `
        <div class="mmo-form">
          <h1>MathOMeter</h1>
          <p>Loading...</p>
          <p style="font-size:14px; opacity:0.8;">(JSON + preload)</p>
        </div>
      `;

      const preloadAudio = (src) => new Promise((resolve, reject) => {
        const a = new Audio();
        a.preload = "auto";
        a.src = src;
        a.oncanplaythrough = () => resolve(true);
        a.onerror = () => reject(new Error(`Audio preload error: ${src}`));
      });

      const preloadVideo = (src) => new Promise((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "auto";
        v.src = src;
        v.oncanplaythrough = () => resolve(true);
        v.onerror = () => reject(new Error(`Video preload error: ${src}`));
      });

      (async () => {
        try {
          const allSentences = await loadJSON("data/all_sentences_info.json");
          const sentenceAssoc = await loadJSON("data/sentence_to_character.json");

          const subjectId = window.MMO_SUBJECT_ID;
          const subjectNumber = 1; // per ora fisso

          const params = prepareSubject(subjectId, subjectNumber, allSentences, sentenceAssoc);
          window.MMO_PARAMS = params;

          // preload demo primo trial
          const trialCfg = params.runs[0].trials[0];
          const audios = [trialCfg.beep, trialCfg.audioFile];
          const videos = [trialCfg.animSentenceFile, trialCfg.animWaitFile, trialCfg.robotOk, trialCfg.robotNotOk];

          await Promise.all([
            ...audios.map(preloadAudio),
            ...videos.map(preloadVideo)
          ]);

          this.jsPsych.finishTrial({ loaded: true });
        } catch (e) {
          console.error(e);
          display_element.innerHTML = `
            <div class="mmo-form">
              <h1>Errore</h1>
              <p>Non riesco a caricare JSON o media.</p>
              <p style="font-size:14px; opacity:0.8;">Apri Console (F12) per il dettaglio.</p>
            </div>
          `;
        }
      })();
    }
  }

  Plugin.info = info;
  return Plugin;
})();

// ====== 1 TRIAL BLOCK ======
function addOneTrialBlock(runTimeline, cfg, jsPsych) {

  // 1) BEEP
  runTimeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: fixationHTML(),
    choices: "NO_KEYS",
    on_start: () => setDebugLabel(`BEEP (run ${cfg.run} trial ${cfg.trialIndex})`),
    on_load: () => {
      const trialRow = cfg.trialIndex - 1; // <<< freeze
      MMO_TRIAL_I = trialRow;

      if (cfg.trialIndex === 1 || MMO_RUN_QUESTIONS == null) {
        MMO_RUN_QUESTIONS = newRunQuestions();
      }

      MMO_RUN_QUESTIONS.onsets[trialRow] = [-1, -1, -1, -1, -1, -1];
      MMO_RUN_QUESTIONS.sentenceNames[trialRow] = cfg.audioFile;
      MMO_RUN_QUESTIONS.truthValue[trialRow] = cfg.truthValue;
      MMO_RUN_QUESTIONS.type[trialRow] = cfg.category;

      // PTB-like: playblocking(beep) then flip-like timestamp stored as onset(1)
      const a = new Audio(cfg.beep);
      a.addEventListener("ended", () => {
        MMO_BEEP_T0_MS = performance.now();

        stampFlip((tFlip) => {
          MMO_RUN_QUESTIONS.onsets[trialRow][0] = relToTTL_s(tFlip); // col1 (flip-like)
          jsPsych.finishTrial({ phase: "beep", ...cfg });
        });
      });
      a.play();
    },
    on_finish: () => clearDebugLabel()
  });

  // 2) SENTENCE (onset(2) GetSecs-like)
  runTimeline.push({
    type: jsPsychVideoAudioKeyboardResponse,
    video: () => cfg.animSentenceFile,
    audio: () => cfg.audioFile,
    choices: "NO_KEYS",
    trial_ends_after_audio: true,
    trial_ends_after_video: false,
    // width: 800, // <-- meglio CSS responsive in index.html
    on_start: () => {
      setDebugLabel("SENTENCE");
      const trialRow = cfg.trialIndex - 1; // <<< freeze
      MMO_RUN_QUESTIONS.onsets[trialRow][1] = relToTTL_s(performance.now()); // col2 (GetSecs-like)
    },
    on_finish: () => clearDebugLabel(),
    data: () => ({ phase: "sentence", ...cfg })
  });

  // 3) WAIT / RESPONSE PERIOD (4s fixed, onset(3) flip-like, PTB-like firstPress)
  runTimeline.push({
    type: jsPsychVideoKeyboardResponse,
    stimulus: () => [cfg.animWaitFile],
    choices: ["b", "y"],
    response_ends_trial: false,
    trial_duration: timing.responseDuration * 1000, // 4s fixed

    on_start: () => {
      setDebugLabel("WAIT (b=right, y=left)");
    },

    on_load: function () {
      const trialRow = cfg.trialIndex - 1; // <<< freeze

      // reset response state
      MMO_FIRST_PRESS_MS = null;
      MMO_FIRST_KEY = null;
      MMO_GOT_RESP = false;

      // start/loop video immediately (stability)
      const v = document.querySelector("#jspsych-content video");
      if (v) {
        v.loop = true;
        v.play().catch(() => {}); // prevents "frozen after first trial" in some browsers
      }

      // PTB-like queue: first valid keydown timestamp absolute
      const onKeyDown = (e) => {
        const k = (e.key || "").toLowerCase();
        if (k !== "b" && k !== "y") return;

        if (!MMO_GOT_RESP) {
          MMO_GOT_RESP = true;
          MMO_FIRST_KEY = k;
          MMO_FIRST_PRESS_MS = performance.now();
        }
      };

      window.addEventListener("keydown", onKeyDown, { capture: true });
      this._mmo_onKeyDown = onKeyDown;

      // col3: flip-like start response period timestamp
      stampFlip((tFlipRespStart) => {
        MMO_WAIT_START_MS = tFlipRespStart;
        MMO_RUN_QUESTIONS.onsets[trialRow][2] = relToTTL_s(MMO_WAIT_START_MS); // col3
      });
    },

    on_finish: function () {
      clearDebugLabel();
      const trialRow = cfg.trialIndex - 1; // <<< freeze

      // stop "queue"
      if (this._mmo_onKeyDown) {
        window.removeEventListener("keydown", this._mmo_onKeyDown, { capture: true });
        this._mmo_onKeyDown = null;
      }

      // Response & RT PTB-like
      if (!MMO_GOT_RESP) {
        MMO_RUN_QUESTIONS.response[trialRow] = "NA";
        MMO_RUN_QUESTIONS.rt[trialRow] = -1;
      } else {
        MMO_RUN_QUESTIONS.response[trialRow] = keyToTrueFalse(MMO_FIRST_KEY, cfg.trueSide);
        MMO_RUN_QUESTIONS.rt[trialRow] = relToTTL_s(MMO_FIRST_PRESS_MS); // pressTime - TTL
      }

      MMO_RUN_QUESTIONS._gotResp[trialRow] = MMO_GOT_RESP;
    },

    data: () => ({ phase: "wait", ...cfg })
  });

  // 4) FEEDBACK (onset(4) GetSecs-like, movie depends on gotResp)
  runTimeline.push({
    type: jsPsychVideoKeyboardResponse,
    stimulus: () => {
      const trialRow = cfg.trialIndex - 1;
      const gotResp = MMO_RUN_QUESTIONS._gotResp?.[trialRow] === true;
      return [gotResp ? cfg.robotOk : cfg.robotNotOk];
    },
    choices: "NO_KEYS",
    trial_duration: timing.feedbackDuration * 1000,
    on_start: () => {
      setDebugLabel("FEEDBACK");
      const trialRow = cfg.trialIndex - 1; // <<< freeze
      MMO_RUN_QUESTIONS.onsets[trialRow][3] = relToTTL_s(performance.now()); // col4 (GetSecs-like)

      const v = document.querySelector("#jspsych-content video");
      if (v) v.loop = true;
    },
    on_finish: () => clearDebugLabel(),
    data: () => ({ phase: "feedback", ...cfg })
  });

  // 5) PRE-REST GAP (PTB has ~1s before rest flip is logged)
  runTimeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: fixationHTML(),
    choices: "NO_KEYS",
    trial_duration: 1000,
    data: () => ({ phase: "pre_rest_gap", ...cfg })
  });

  // 6) REST (onset(5)/(6) flip-like)
  runTimeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: fixationHTML(),
    choices: "NO_KEYS",
    trial_duration: timing.restDuration * 1000,
    on_start: () => {
      setDebugLabel("REST");
      const trialRow = cfg.trialIndex - 1; // <<< freeze

      stampFlip((tFlipRestStart) => {
        MMO_RUN_QUESTIONS.onsets[trialRow][4] = relToTTL_s(tFlipRestStart); // col5
      });
    },
    on_finish: () => {
      const trialRow = cfg.trialIndex - 1; // <<< freeze
      stampFlip((tFlipRestEnd) => {
        MMO_RUN_QUESTIONS.onsets[trialRow][5] = relToTTL_s(tFlipRestEnd); // col6
      });
      clearDebugLabel();
    },
    data: () => ({ phase: "rest", ...cfg })
  });

  // === DOPO REST dell’ultimo trial: salva + pausa run (se serve) ===
  if (cfg.trialIndex === NUM_SENTENCES) {
    // 1) salva file run
    runTimeline.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div class="mmo-form"><h1>MathOMeter</h1><p>Saving run ${cfg.run}...</p></div>`,
      choices: "NO_KEYS",
      trial_duration: 10,
      
      on_start: () => {
        const subjectId = window.MMO_SUBJECT_ID || "NA";

        downloadJSON(`mathometer_${subjectId}_run_${cfg.run}_ptb_like.json`, {
          subjectID: subjectId,
          run: cfg.run,
          trueSide: cfg.trueSide,
          mapping: mappingString(cfg.trueSide),
          TTLonset_ms: MMO_TTL_T0_MS,
          questions: MMO_RUN_QUESTIONS
        });

        MMO_RUN_QUESTIONS = null;
      }
    });

    // 2) pausa/confirm solo se NON è l’ultima run
    if (cfg.run < TOTAL_RUNS) {
      runTimeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
          <div class="mmo-form">
            <h1>Run ${cfg.run} completed</h1>
            <p>Next: <b>Run ${cfg.run + 1}</b></p>
            <p style="margin-top:18px;">Press any key to start Run ${cfg.run + 1}</p>
          </div>
        `,
        choices: "ALL_KEYS",
        data: { phase: "run_break", completed_run: cfg.run, next_run: cfg.run + 1 }
      });
    }
  }
}


// ====== START ======
window.addEventListener("DOMContentLoaded", () => {
  const jsPsych = initJsPsych({
    on_finish: () => console.log("Esperimento finito (salvataggi run-by-run già fatti).")
  });

  const timeline = [];

  // SubjectID
  let MMO_subjectId = "";
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
      <div class="mmo-form">
        <h1>MathOMeter</h1>
        <p>Subject ID</p>
        <p style="margin-top:18px;">
          <input id="mmo-subject-id" type="text" autocomplete="off" />
        </p>
        <div class="mmo-hint">Premi <b>INVIO</b> per continuare</div>
      </div>
    `,
    choices: ["Enter"],
    on_load: () => {
      const el = document.getElementById("mmo-subject-id");
      if (!el) return;
      el.focus();
      el.addEventListener("input", () => { MMO_subjectId = el.value; });
      MMO_subjectId = el.value;
    },
    on_finish: () => {
      const subjectId = (MMO_subjectId || "").trim();
      if (!subjectId) {
        alert("Insert a valid subject ID.");
        jsPsych.endExperiment("Dati mancanti.");
        return;
      }
      window.MMO_SUBJECT_ID = subjectId;
      jsPsych.data.addProperties({ subject_id: subjectId });
    }
  });

  // TTL anchor
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
      <div class="mmo-form">
        <h1>MathOMeter</h1>
        <p>Tocca un qualunque tasto per cominciare</p>
      </div>
    `,
    choices: "ALL_KEYS",
    data: { phase: "press_any_key" },
    on_finish: () => {
      if (MMO_TTL_T0_MS == null) MMO_TTL_T0_MS = performance.now();
    }
  });

  // Loader
  timeline.push({ type: jsPsychMmoLoader });

  // Fixation pre-beep (solo una volta)
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: fixationHTML(),
    choices: "NO_KEYS",
    trial_duration: timing.fixationDuration * 1000,
    on_start: () => setDebugLabel("FIXATION"),
    on_finish: () => clearDebugLabel(),
    data: { phase: "fixation_pre_beep" }
  });

  // Builder
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="mmo-form"><h1>MathOMeter</h1><p>Preparing trials...</p></div>`,
    choices: "NO_KEYS",
    trial_duration: 50,
    on_start: () => {
      const params = window.MMO_PARAMS;
      if (!params) throw new Error("MMO_PARAMS non trovato: loader non ha caricato i parametri.");

      const runTimeline = [];

      for (let r = 0; r < params.runs.length; r++) {
        for (let t = 0; t < params.runs[r].trials.length; t++) {
          addOneTrialBlock(runTimeline, params.runs[r].trials[t], jsPsych);
        }
      }

      jsPsych.addNodeToEndOfTimeline({ timeline: runTimeline });
    }
  });

  jsPsych.run(timeline);
});
