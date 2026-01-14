// main.js — MathOMeter FULL (6 run x 20 trial)
// PTB-LIKE TIMING + PTB-IDENTICAL PARAMS + PTB-IDENTICAL RUN FILE NAMING
//
// Struttura:
//   1) SubjectNumber (tastiera + INVIO)
//   2) TTL onset / start: touch ovunque OPPURE qualsiasi tasto
//   3) Loader (JSON + preload demo)
//   4) Trials
//
// Salvataggio:
//   - params (PTB-like): mathometer_subjXX_params.json (1 volta all'inizio, opzionale anche ad ogni run)
//   - run data:          mathometer_subjXX_run_1..6.json  (runIndex = ordine di esecuzione, come PTB runs(i))
//
// PTB-like timing/log:
// questions.onsets(trial,:) = [beepFlip, sentenceStart, respFlip, feedbackStart, restFlipStart, restFlipEnd]
// col1/3/5/6 = "Flip-based"  -> requestAnimationFrame timestamp (flip-like)
// col2/4     = "GetSecs-based" -> performance.now timestamp
//
// PTB-identical behavior targets:
// - run_order = randperm(totalRuns) PER SOGGETTO, persistente (come params.mat)
// - within each run: shuffle sentences, take 20
// - character list: circshift(CharList, mod(subjectNumber,NCharacters)) then take first 20
// - trueSide: random for first RUN-INDEX, then alternates (3 - prev)
// - FILE naming: run_1..run_6 in ordine di esecuzione (runIndex), NON runNumber originale
//
// Interrupt/resume (browser):
// - lastRunCompleted viene salvato in localStorage e sovrascritto (come PTB che sovrascrive params.mat)
// - se ricarichi e reinserisci lo stesso subjectNumber, riparte da lastRunCompleted+1
//
// =========================
// ⚠️ IMPORTANT: index.html
// =========================
// Per far funzionare "touch anywhere" nel TTL anchor devi includere anche:
// <script src="https://unpkg.com/@jspsych/plugin-html-button-response@1.1.3"></script>
//
// =========================
// CONFIG
// =========================
const DOWNLOAD_PARAMS_AT_START = true;      // scarica mathometer_subjXX_params.json all'inizio
const DOWNLOAD_PARAMS_EACH_RUN = false;     // se true, scarica anche un params "snapshot" dopo ogni run (non sovrascrivibile)

// =========================
// GLOBALS / CONSTANTS
// =========================
let MMO_BEEP_T0_MS = null;

const timing = {
  fixationDuration: 1.0,
  responseDuration: 4.0,
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
let MMO_TRIAL_I = 0;          // debug
let MMO_RUN_QUESTIONS = null; // buffer run corrente

// Response capture state (PTB-like "KbQueue firstPress")
let MMO_WAIT_START_MS = null;
let MMO_FIRST_PRESS_MS = null;
let MMO_FIRST_KEY = null;     // può essere: "b","y","left","right"
let MMO_GOT_RESP = false;

function newRunQuestions() {
  return {
    onsets: [],
    response: [],
    rt: [],
    sentenceNames: [],
    truthValue: [],
    type: [],
    _gotResp: []
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

/* =========================
   ✅ TOUCH SUPPORT HELPERS
   ========================= */
// accetta "b","y" oppure "left","right"
function anyToSide(x) {
  if (x === "left" || x === "right") return x;
  return keyToSide(x);
}

// trueSide: 1 TRUE a destra (b), 2 TRUE a sinistra (y)
function anyToTrueFalse(x, trueSide) {
  const side = anyToSide(x);
  if (!side) return "NA";
  if (trueSide === 1) return (side === "right") ? "True" : "False";
  return (side === "left") ? "True" : "False";
}

function mappingString(trueSide) {
  return (trueSide === 1)
    ? "True=right(b/tap-right), False=left(y/tap-left)"
    : "True=left(y/tap-left), False=right(b/tap-right)";
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

// Fisher–Yates shuffle IN-PLACE
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Like randperm(n) in MATLAB -> indices 0..n-1 shuffled
function randpermIdx(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  return shuffleInPlace(a);
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

function subjStr2(subjectNumber) {
  return String(subjectNumber).padStart(2, "0");
}

// circshift for arrays: positive shift => shift right
function circshift(arr, shiftRight) {
  const n = arr.length;
  if (n === 0) return [];
  const k = ((shiftRight % n) + n) % n;
  if (k === 0) return arr.slice();
  return arr.slice(n - k).concat(arr.slice(0, n - k));
}

// ====== PTB-LIKE PARAM FILE via localStorage ======
function paramsKey(subjectNumber) {
  return `mmo_params_subj_${subjStr2(subjectNumber)}`;
}

function saveSubjectParams(subjectNumber, params) {
  localStorage.setItem(paramsKey(subjectNumber), JSON.stringify(params));
}

function loadSubjectParams(subjectNumber) {
  const raw = localStorage.getItem(paramsKey(subjectNumber));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function updateLastRunCompleted(subjectNumber, lastRunCompleted) {
  const saved = loadSubjectParams(subjectNumber);
  if (!saved) return;
  saved.lastRunCompleted = lastRunCompleted;
  saved.updatedAt_ms = Date.now();
  saveSubjectParams(subjectNumber, saved);
}

// ====== BUILD PARAMS PTB-IDENTICAL + TRIAL CFG ======
function buildParamsAndTrials_PTBlike(subjectNumber, allSentences, assoc) {
  const N_CHARACTERS = CHARACTER_IDS.length;

  // 1) run_order persistente
  let saved = loadSubjectParams(subjectNumber);
  let runOrder;
  let lastRunCompleted = 0;

  if (saved && Array.isArray(saved.runOrder) && saved.runOrder.length === TOTAL_RUNS) {
    runOrder = saved.runOrder.slice();
    lastRunCompleted = Number(saved.lastRunCompleted || 0);
    if (!Number.isFinite(lastRunCompleted) || lastRunCompleted < 0) lastRunCompleted = 0;
  } else {
    runOrder = randpermIdx(TOTAL_RUNS).map(i => i + 1); // 1..6
    lastRunCompleted = 0;
    saved = { runOrder, lastRunCompleted, createdAt_ms: Date.now() };
    saveSubjectParams(subjectNumber, saved);
  }

  const runs = [];

  for (let i = 0; i < TOTAL_RUNS; i++) {
    const runIndex = i + 1;        // ordine esecuzione 1..6
    const runNumber = runOrder[i]; // run originale 1..6

    // sentences: select by runNumber, shuffle, take 20
    const sentencesThisRun = allSentences.filter(s => Number(s.run) === Number(runNumber));
    if (sentencesThisRun.length < NUM_SENTENCES) {
      throw new Error(`Run ${runNumber}: trovate ${sentencesThisRun.length} frasi (< ${NUM_SENTENCES}).`);
    }
    const sentIdx = randpermIdx(sentencesThisRun.length);
    const orderedSentences = sentIdx.map(k => sentencesThisRun[k]).slice(0, NUM_SENTENCES);

    // CharList: association, circshift(mod(subjectNumber,NCharacters))
    const charAssoc = assoc.find(r => Number(r.run) === Number(runNumber));
    if (!charAssoc) throw new Error(`Nessuna SentenceCharacterAssociation per run ${runNumber}`);

    const CharList = charAssoc.characters.slice();
    if (CharList.length < NUM_SENTENCES) {
      throw new Error(`Run ${runNumber}: CharList length ${CharList.length} (< ${NUM_SENTENCES}).`);
    }

    const shift = subjectNumber % N_CHARACTERS;
    const shiftedCharList = circshift(CharList, shift);
    const thisRunChars = shiftedCharList.slice(0, NUM_SENTENCES);

    // trueSide: random first runIndex, then alternate
    let trueSide;
    if (i === 0) trueSide = (Math.random() < 0.5) ? 1 : 2;
    else trueSide = 3 - runs[i - 1].trueSide;

    // ----- PTB-like params arrays -----
    const sentenceNames = [];
    const characters = [];
    const genders = [];
    const sentenceCateg = [];
    const sentenceTheme = [];
    const sentenceTruth = [];
    const sentenceGender = [];
    const animationNameIdx = [];    // 20x4 1-based indices

    const robotOkIdx = 4 * N_CHARACTERS + 1;    // 17
    const robotNotokIdx = 4 * N_CHARACTERS + 2; // 18

    // ----- runtime trials config -----
    const trials = [];

    for (let t = 0; t < NUM_SENTENCES; t++) {
      const s = orderedSentences[t];
      const characterId = thisRunChars[t];
      const gender = CHARACTER_GENDER[characterId];

      if (i === 0 && t === 0) {
        console.log(
          "DEBUG subj", subjectNumber,
          "runIndex", runIndex,
          "runNumber", runNumber,
          "trial1 character", characterId,
          "(runOrder=", runOrder.join(","), ")"
        );
      }

      const sentenceFileNameOnly =
        `Sentence${s.sentenceId}_${s.category}_${s.theme}_${s.truthValue}_Gender_${gender}.wav`;

      const c = CHARACTER_IDS.indexOf(characterId) + 1; // 1..4
      const baseIdx = 4 * (c - 1); // 0,4,8,12
      let sentIdx1, waitIdx1;
      if (trueSide === 1) { // TRUE right
        sentIdx1 = baseIdx + 1;
        waitIdx1 = baseIdx + 3;
      } else {              // TRUE left
        sentIdx1 = baseIdx + 2;
        waitIdx1 = baseIdx + 4;
      }

      sentenceNames.push(sentenceFileNameOnly);
      characters.push(characterId);
      genders.push(gender);

      sentenceCateg.push(s.category);
      sentenceTheme.push(s.theme);
      sentenceTruth.push(s.truthValue);
      sentenceGender.push(gender);

      animationNameIdx.push([sentIdx1, waitIdx1, robotOkIdx, robotNotokIdx]);

      const cIndex = c;
      const sentAnimName = (trueSide === 1) ? "SentenceTrueRight" : "SentenceTrueLeft";
      const waitAnimName = (trueSide === 1) ? "WaitTrueRight" : "WaitTrueLeft";

      // ✅ FIX: su GitHub i file sono .MP4 (case-sensitive)
      trials.push({
        runIndex,
        runNumber,
        trialIndex: t + 1,
        trueSide,
        subjectNumber,

        sentenceId: s.sentenceId,
        category: s.category,
        theme: s.theme,
        truthValue: s.truthValue,

        characterId,
        gender,

        audioFile: `Sentences/${sentenceFileNameOnly}`,
        animSentenceFile: `Animations/${sentAnimName}P${cIndex}.MP4`,
        animWaitFile: `Animations/${waitAnimName}P${cIndex}.MP4`,
        robotOk: `Animations/FeedbackOkRobot.MP4`,
        robotNotOk: `Animations/FeedbackNotokRobot.MP4`,
        beep: `Sentences/beep.wav`,
      });
    }

    runs.push({
      runIndex,
      runNumber,
      trueSide,

      // PTB-like stored params
      sentenceNames,
      characters,
      genders,
      sentenceCateg,
      sentenceTheme,
      sentenceTruth,
      sentenceGender,
      animationNameIdx,

      // runtime
      trials
    });
  }

  return {
    subjectNumber,
    runOrder,
    lastRunCompleted,
    runs
  };
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

          const subjectNumber = window.MMO_SUBJECT_NUMBER;
          if (!Number.isFinite(subjectNumber)) throw new Error("MMO_SUBJECT_NUMBER non valido (NaN).");

          // Build params + trials (PTB-identical)
          const params = buildParamsAndTrials_PTBlike(subjectNumber, allSentences, sentenceAssoc);
          window.MMO_PARAMS = params;

          // opzionale: scarica params.json UNA volta all'inizio (snapshot)
          if (DOWNLOAD_PARAMS_AT_START) {
            const subjStr = subjStr2(subjectNumber);
            downloadJSON(`mathometer_subj${subjStr}_params.json`, {
              subjectNumber: params.subjectNumber,
              runOrder: params.runOrder,
              lastRunCompleted: params.lastRunCompleted,
              runs: params.runs.map(r => ({
                runIndex: r.runIndex,
                runNumber: r.runNumber,
                trueSide: r.trueSide,

                sentenceNames: r.sentenceNames,
                characters: r.characters,
                genders: r.genders,
                sentenceCateg: r.sentenceCateg,
                sentenceTheme: r.sentenceTheme,
                sentenceTruth: r.sentenceTruth,
                sentenceGender: r.sentenceGender,
                animationNameIdx: r.animationNameIdx
              })),
              createdAt_ms: Date.now()
            });
          }

          // preload demo: primo trial della prima run DA ESEGUIRE (runIndex = lastRunCompleted+1)
          const startRunIndex = Math.min(Math.max(params.lastRunCompleted + 1, 1), TOTAL_RUNS);
          const firstRun = params.runs.find(r => r.runIndex === startRunIndex);
          if (!firstRun) throw new Error("Run di partenza non trovata nei params.");
          const trialCfg = firstRun.trials[0];

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
    on_start: () => setDebugLabel(`BEEP (run ${cfg.runIndex} / orig ${cfg.runNumber} trial ${cfg.trialIndex})`),
    on_load: () => {
      const trialRow = cfg.trialIndex - 1; // freeze
      MMO_TRIAL_I = trialRow;

      if (cfg.trialIndex === 1 || MMO_RUN_QUESTIONS == null) {
        MMO_RUN_QUESTIONS = newRunQuestions();
      }

      MMO_RUN_QUESTIONS.onsets[trialRow] = [-1, -1, -1, -1, -1, -1];
      MMO_RUN_QUESTIONS.sentenceNames[trialRow] = cfg.audioFile;
      MMO_RUN_QUESTIONS.truthValue[trialRow] = cfg.truthValue;
      MMO_RUN_QUESTIONS.type[trialRow] = cfg.category;

      const a = new Audio(cfg.beep);
      a.addEventListener("ended", () => {
        MMO_BEEP_T0_MS = performance.now();
        stampFlip((tFlip) => {
          MMO_RUN_QUESTIONS.onsets[trialRow][0] = relToTTL_s(tFlip);
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
    on_start: () => {
      setDebugLabel("SENTENCE");
      const trialRow = cfg.trialIndex - 1; // freeze
      MMO_RUN_QUESTIONS.onsets[trialRow][1] = relToTTL_s(performance.now());
    },
    on_finish: () => clearDebugLabel(),
    data: () => ({ phase: "sentence", ...cfg })
  });

  // 3) WAIT / RESPONSE PERIOD (4s fixed, onset(3) flip-like)
  runTimeline.push({
    type: jsPsychVideoKeyboardResponse,
    stimulus: () => [cfg.animWaitFile],

    // tastiera (fallback) + touch (pointerdown)
    choices: ["b", "y"],
    response_ends_trial: false,
    trial_duration: timing.responseDuration * 1000,

    on_start: () => {
      setDebugLabel("WAIT (tap left/right | keyboard: b=right, y=left)");
    },

    on_load: function () {
      const trialRow = cfg.trialIndex - 1; // freeze

      // reset response state
      MMO_FIRST_PRESS_MS = null;
      MMO_FIRST_KEY = null;
      MMO_GOT_RESP = false;

      // start/loop video immediately (stability)
      const v = document.querySelector("#jspsych-content video");
      if (v) {
        v.loop = true;
        v.play().catch(() => {});
      }

      // PTB-like queue: first valid keydown timestamp absolute
      const onKeyDown = (e) => {
        const k = (e.key || "").toLowerCase();
        if (k !== "b" && k !== "y") return;
        if (!MMO_GOT_RESP) {
          MMO_GOT_RESP = true;
          MMO_FIRST_KEY = k;                 // "b" o "y"
          MMO_FIRST_PRESS_MS = performance.now();
        }
      };
      window.addEventListener("keydown", onKeyDown, { capture: true });
      this._mmo_onKeyDown = onKeyDown;

      // ✅ TOUCH: tap metà schermo sinistra/destra
      const onPointerDown = (e) => {
        if (MMO_GOT_RESP) return;

        try { e.preventDefault(); } catch {}
        try { e.stopPropagation(); } catch {}

        const x = e.clientX;
        const side = (x < window.innerWidth / 2) ? "left" : "right";

        MMO_GOT_RESP = true;
        MMO_FIRST_KEY = side;                // "left" o "right"
        MMO_FIRST_PRESS_MS = performance.now();
      };
      window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
      this._mmo_onPointerDown = onPointerDown;

      // col3: flip-like start response period timestamp
      stampFlip((tFlipRespStart) => {
        MMO_WAIT_START_MS = tFlipRespStart;
        MMO_RUN_QUESTIONS.onsets[trialRow][2] = relToTTL_s(MMO_WAIT_START_MS);
      });
    },

    on_finish: function () {
      clearDebugLabel();
      const trialRow = cfg.trialIndex - 1; // freeze

      // stop listeners
      if (this._mmo_onKeyDown) {
        window.removeEventListener("keydown", this._mmo_onKeyDown, { capture: true });
        this._mmo_onKeyDown = null;
      }
      if (this._mmo_onPointerDown) {
        window.removeEventListener("pointerdown", this._mmo_onPointerDown, { capture: true });
        this._mmo_onPointerDown = null;
      }

      // Response & RT PTB-like
      if (!MMO_GOT_RESP) {
        MMO_RUN_QUESTIONS.response[trialRow] = "NA";
        MMO_RUN_QUESTIONS.rt[trialRow] = -1;
      } else {
        MMO_RUN_QUESTIONS.response[trialRow] = anyToTrueFalse(MMO_FIRST_KEY, cfg.trueSide);
        MMO_RUN_QUESTIONS.rt[trialRow] = relToTTL_s(MMO_FIRST_PRESS_MS);
      }

      MMO_RUN_QUESTIONS._gotResp[trialRow] = MMO_GOT_RESP;
    },

    data: () => ({ phase: "wait", ...cfg })
  });

  // 4) FEEDBACK (onset(4) GetSecs-like)
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
      const trialRow = cfg.trialIndex - 1; // freeze
      MMO_RUN_QUESTIONS.onsets[trialRow][3] = relToTTL_s(performance.now());
      const v = document.querySelector("#jspsych-content video");
      if (v) v.loop = true;
    },
    on_finish: () => clearDebugLabel(),
    data: () => ({ phase: "feedback", ...cfg })
  });

  // 5) PRE-REST GAP
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
      const trialRow = cfg.trialIndex - 1; // freeze
      stampFlip((tFlipRestStart) => {
        MMO_RUN_QUESTIONS.onsets[trialRow][4] = relToTTL_s(tFlipRestStart);
      });
    },
    on_finish: () => {
      const trialRow = cfg.trialIndex - 1; // freeze
      stampFlip((tFlipRestEnd) => {
        MMO_RUN_QUESTIONS.onsets[trialRow][5] = relToTTL_s(tFlipRestEnd);
      });
      clearDebugLabel();
    },
    data: () => ({ phase: "rest", ...cfg })
  });

  // === end of run ===
  if (cfg.trialIndex === NUM_SENTENCES) {
    runTimeline.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `<div class="mmo-form"><h1>MathOMeter</h1><p>Saving run ${cfg.runIndex}...</p></div>`,
      choices: "NO_KEYS",
      trial_duration: 10,
      on_start: () => {
        const subjectNumber = window.MMO_SUBJECT_NUMBER;
        const subjStr = subjStr2(subjectNumber);
        const runOrder = window.MMO_PARAMS?.runOrder || null;

        updateLastRunCompleted(subjectNumber, cfg.runIndex);

        if (window.MMO_PARAMS) window.MMO_PARAMS.lastRunCompleted = cfg.runIndex;

        if (DOWNLOAD_PARAMS_EACH_RUN) {
          const p = loadSubjectParams(subjectNumber);
          downloadJSON(`mathometer_subj${subjStr}_params_after_run_${cfg.runIndex}.json`, p || {});
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            downloadJSON(`mathometer_subj${subjStr}_run_${cfg.runIndex}.json`, {
              subjectNumber,
              runIndex: cfg.runIndex,
              runNumber: cfg.runNumber,
              runOrder,
              trueSide: cfg.trueSide,
              mapping: mappingString(cfg.trueSide),
              TTLonset_ms: MMO_TTL_T0_MS,
              questions: MMO_RUN_QUESTIONS
            });

            MMO_RUN_QUESTIONS = null;
          });
        });
      }
    });

    const isLastRun = (cfg.runIndex === TOTAL_RUNS);
    if (!isLastRun) {
      runTimeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
          <div class="mmo-form">
            <h1>Run ${cfg.runIndex} completed</h1>
            <p>Next: <b>Run ${cfg.runIndex + 1}</b></p>
            <p style="margin-top:18px;">Press any key to start next run</p>
          </div>
        `,
        choices: "ALL_KEYS",
        data: { phase: "run_break", completed_runIndex: cfg.runIndex, completed_runNumber: cfg.runNumber }
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

  // 1) Subject number: tastiera + INVIO
  let MMO_subjectNumberStr = "";
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
      <div class="mmo-form">
        <h1>MathOMeter</h1>
        <p>Subject number (e.g., 01, 02, 12...)</p>
        <p style="margin-top:18px;">
          <input id="mmo-subject-number" type="text" inputmode="numeric" autocomplete="off" />
        </p>
        <div class="mmo-hint">Premi <b>INVIO</b> per continuare</div>
      </div>
    `,
    choices: ["Enter"],
    on_load: () => {
      const el = document.getElementById("mmo-subject-number");
      if (!el) return;
      el.focus();
      el.addEventListener("input", () => { MMO_subjectNumberStr = el.value; });
      MMO_subjectNumberStr = el.value;
    },
    on_finish: () => {
      const n = parseInt((MMO_subjectNumberStr || "").trim(), 10);
      if (!Number.isFinite(n) || n < 1) {
        alert("Insert a valid subject number (1, 2, 3, …).");
        jsPsych.endExperiment("Dati mancanti.");
        return;
      }
      window.MMO_SUBJECT_NUMBER = n;
      jsPsych.data.addProperties({ subject_number: n });
    }
  });

  // 2) TTL anchor: touch ovunque OPPURE qualsiasi tasto
  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="mmo-form">
        <h1>MathOMeter</h1>
        <p>Tocca lo schermo per cominciare</p>
        <p style="font-size:14px; opacity:0.8;">(oppure premi un tasto)</p>
      </div>
    `,
    choices: [" "],
    button_html: `
      <button style="
        position:fixed; inset:0;
        width:100vw; height:100vh;
        opacity:0; border:0; padding:0; margin:0;
        background:transparent;
        cursor:pointer;
      " aria-label="Start"></button>
    `,
    data: { phase: "press_any_key_or_touch" },

    on_load: function () {
      const onKeyDown = (e) => {
        try { e.preventDefault(); } catch {}
        try { e.stopPropagation(); } catch {}
        jsPsych.finishTrial({ started_by: "keyboard" });
      };
      window.addEventListener("keydown", onKeyDown, { capture: true });
      this._mmo_start_onKeyDown = onKeyDown;
    },

    on_finish: function (data) {
      if (this._mmo_start_onKeyDown) {
        window.removeEventListener("keydown", this._mmo_start_onKeyDown, { capture: true });
        this._mmo_start_onKeyDown = null;
      }

      if (MMO_TTL_T0_MS == null) MMO_TTL_T0_MS = performance.now();
      if (!data.started_by) data.started_by = "touch";
    }
  });

  // 3) Loader
  timeline.push({ type: jsPsychMmoLoader });

  // 4) Resume
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => {
      const params = window.MMO_PARAMS;
      const subjectNumber = window.MMO_SUBJECT_NUMBER;
      const last = Number(params?.lastRunCompleted || 0);
      const next = Math.min(Math.max(last + 1, 1), TOTAL_RUNS);

      if (last >= TOTAL_RUNS) {
        return `
          <div class="mmo-form">
            <h1>MathOMeter</h1>
            <p>Subject ${subjStr2(subjectNumber)} has completed all runs.</p>
            <p style="margin-top:18px;">Press any key to end.</p>
          </div>
        `;
      }

      return `
        <div class="mmo-form">
          <h1>MathOMeter</h1>
          <p>Subject <b>${subjStr2(subjectNumber)}</b></p>
          <p>Last run completed: <b>${last}</b></p>
          <p>Starting from: <b>Run ${next}</b></p>
          <p style="margin-top:18px;">Press any key to continue</p>
        </div>
      `;
    },
    choices: "ALL_KEYS",
    on_finish: () => {
      const params = window.MMO_PARAMS;
      const last = Number(params?.lastRunCompleted || 0);
      if (last >= TOTAL_RUNS) {
        jsPsych.endExperiment("All runs completed.");
      }
    }
  });

  // Fixation pre-beep
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: fixationHTML(),
    choices: "NO_KEYS",
    trial_duration: timing.fixationDuration * 1000,
    on_start: () => setDebugLabel("FIXATION"),
    on_finish: () => clearDebugLabel(),
    data: { phase: "fixation_pre_beep" }
  });

  // Build run timeline dinamicamente (resume)
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: fixationHTML(),
    choices: "NO_KEYS",
    trial_duration: 1,
    on_start: () => {
      const params = window.MMO_PARAMS;
      if (!params) throw new Error("MMO_PARAMS non trovato: loader non ha caricato i parametri.");

      const startRunIndex = Math.min(Math.max((params.lastRunCompleted || 0) + 1, 1), TOTAL_RUNS);

      const runTimeline = [];

      for (let r = 0; r < params.runs.length; r++) {
        const run = params.runs[r];
        if (run.runIndex < startRunIndex) continue;

        for (let t = 0; t < run.trials.length; t++) {
          addOneTrialBlock(runTimeline, run.trials[t], jsPsych);
        }
      }

      jsPsych.addNodeToEndOfTimeline({ timeline: runTimeline });
    }
  });

  jsPsych.run(timeline);
});

