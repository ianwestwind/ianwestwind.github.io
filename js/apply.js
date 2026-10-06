// ============================================================
// Multimodal Intelligence Lab — apply.js
// Qualtrics-style applications. Forms 1–3 are public.
// Form 4 (volunteer transition) is for signed-in members.
// Every submission is stored flat so the lab can review one sheet.
// ============================================================

import { db, storage } from "./firebase-config.js";
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { hasRole } from "./auth.js?v=13";

const LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];
const PROFICIENCY = [
  ["None", "None"],
  ["Beginner", "Beginner: coursework or basic familiarity"],
  ["Intermediate", "Intermediate: used independently in a project"],
  ["Advanced", "Advanced: extensive experience or publication-level work"]
];
const TRAINEE_SKILL_GROUPS = [
  {
    title: "A. Computing & Engineering",
    items: [
      "Programming & reproducible coding (Python, R, MATLAB, SQL, Git, visualization)",
      "Software & mobile app development (iOS/Android, APIs, full-stack, mHealth apps)",
      "Data engineering & databases (ETL pipelines, PostgreSQL/MongoDB, large-scale data handling)",
      "Cloud & high-performance computing (AWS/GCP/Azure, SLURM, GPUs, Docker)"
    ]
  },
  {
    title: "B. AI & Quantitative Methods",
    items: [
      "Machine learning & deep learning (PyTorch/TensorFlow, time-series models, unsupervised learning/phenotyping, explainability)",
      "Multimodal & foundation models (multimodal fusion, LLMs, vision-language models, fine-tuning)",
      "Statistics & causal inference (regression, longitudinal/mixed effects, survival, Bayesian methods, missing data, causal methods)"
    ]
  },
  {
    title: "C. Data Modalities",
    items: [
      "Imaging & video (DICOM, medical imaging, computer vision, pose/motion capture)",
      "Clinical & biomedical data (EHR, FHIR/OMOP, clinical notes/NLP, omics)",
      "Physiological signals, wearables & audio (ECG, EEG, PPG, IMU, speech/voice)",
      "Behavioral, survey & environmental data (EMA, patient-reported outcomes, GIS/exposure data)"
    ]
  },
  {
    title: "D. Real-Time Monitoring & Adaptive Intervention",
    items: [
      "Real-time monitoring & digital phenotyping (passive sensing, state estimation, early warning, streaming/on-device models)",
      "Digital twins & dynamical systems (patient-specific simulation, feedback/closed-loop control)",
      "Adaptive intervention design (reinforcement learning/bandits, JITAIs, micro-randomized and SMART trials)"
    ]
  },
  {
    title: "E. Research & Clinical Skills",
    items: [
      "Study design & human subjects research (IRB, consent, CITI, recruitment, data collection)",
      "Data annotation & quality control (labeling images, text, video, signals)",
      "Scientific writing & communication (literature review, manuscripts, presentations)",
      { name: "Clinical or domain expertise (specify specialty or field)", detail: "Specialty or field", optional: true }
    ]
  }
];
const HEARD = ["Lab website", "A lab member", "Advisor or instructor", "Conference or talk", "Social media", "Other"];
const YESNO = [["yes", "Yes"], ["no", "No"]];

const UNDERGRAD_SKILLS = ["Programming", "Math / statistics", "ML coursework", "Data annotation", "Writing"];

function field(key, label, type, extra = {}) {
  return { key, label, type, required: true, ...extra };
}
function optional(key, label, type, extra = {}) {
  return field(key, label, type, { required: false, ...extra });
}

const ABOUT = [
  field("fullName", "Full name", "text"),
  optional("preferredName", "Preferred name", "text"),
  optional("pronouns", "Pronouns", "text", { hint: "Optional" }),
  field("email", "Email", "email", { hint: "An institutional address is preferred." }),
  field("phone", "Phone", "tel"),
  field("institution", "Current institution or organization", "text"),
  field("department", "Department", "text"),
  field("title", "Position or title", "text"),
  optional("linkedin", "LinkedIn", "url"),
  optional("scholar", "Google Scholar", "url"),
  optional("github", "GitHub", "url"),
  optional("website", "Personal website", "url"),
  field("cv", "CV or résumé", "file", { accept: ".pdf,.doc,.docx", hint: "PDF or Word, up to 10 MB." })
];

const INTEREST_FIELDS = [
  field("heardAbout", "How did you hear about the lab?", "radio", { options: HEARD }),
  optional("labContact", "A lab member you have already talked to", "text"),
  field("statement", "Statement of interest", "textarea", {
    hint: "100–500 words. Why this lab, which projects or papers, and what you hope to gain or contribute.",
    minWords: 100,
    maxWords: 500,
    rows: 10
  })
];

const AVAILABILITY = [
  field("startDate", "Earliest start date", "date"),
  field("hoursPerWeek", "Hours per week", "number", { min: 1, max: 80 }),
  field("locationMode", "Where you would work", "radio", { options: ["On-site", "Remote", "Hybrid"] })
];

const CERTIFY = [
  field("accuracyCert", "I certify that the information in this application is accurate.", "checkbox"),
  field("dataConsent", "I consent to the lab storing this application so it can be reviewed.", "checkbox")
];

const isPhd = (a) => a.program === "PhD";
const isPostdoc = (a) => a.program === "Postdoc";
const isMedical = (a) => a.program === "MD" || a.program === "MD-PhD";
const isIndustry = (a) => a.collaboratorType === "Industry";
const isVisiting = (a) => (a.collaboration || []).includes("Visiting scholar / sabbatical");
const isPremed = (a) => a.premed === "yes";
const wantsCredit = (a) => a.requestedStatus === "Credit";

export const FORMS = {
  collaborator: {
    id: "collaborator",
    title: "Collaborator Inquiry",
    intro: "For faculty, research scientists, clinicians, and industry partners. This asks whether there is a project fit, and which agreements would be needed.",
    pages: [
      { id: "about", title: "About you", fields: ABOUT },
      {
        id: "project",
        title: "The collaboration",
        fields: [
          field("collaboratorType", "Which best describes you?", "radio", {
            options: ["Academic faculty", "Research scientist / staff", "Clinician", "Industry", "Government / nonprofit"]
          }),
          field("collaboration", "Proposed collaboration", "checkboxes", {
            options: ["Co-research", "Data sharing", "Grant co-application", "Visiting scholar / sabbatical", "Advising", "Sponsored research"]
          }),
          field("projectDescription", "Short project description", "textarea", { hint: "Aims, data modalities, and expected outputs.", rows: 6 }),
          field("eachSideBrings", "What each side brings", "textarea", { hint: "Data, compute, funding, clinical access, or domain expertise.", rows: 5 }),
          field("timeline", "Proposed timeline", "textarea", { rows: 3 }),
          field("fundingSource", "Funding source", "radio", { options: ["Existing grant", "Planned proposal", "Industry-sponsored", "Not yet identified"] }),
          field("publications", "Two or three relevant publications or products", "textarea", { hint: "One per line.", minLines: 2, rows: 4 }),
          field("company", "Company", "text", { show: isIndustry }),
          field("companyRole", "Your role at the company", "text", { show: isIndustry }),
          field("ndaNeeded", "Is an NDA needed?", "radio", { options: YESNO, show: isIndustry }),
          field("ipExpectations", "IP and publication expectations", "textarea", { rows: 4, show: isIndustry }),
          field("conflictDisclosure", "Conflict-of-interest disclosure", "textarea", { rows: 3, show: isIndustry }),
          field("visitDates", "Proposed visit dates", "text", { show: isVisiting }),
          field("homeSupport", "Home-institution support", "textarea", { rows: 3, show: isVisiting }),
          field("visaNeeds", "Visa sponsorship needs", "radio", { options: ["None", "Needs sponsorship", "Not sure"], show: isVisiting }),
          field("deskCompute", "Desk or compute needs", "textarea", { rows: 3, show: isVisiting })
        ]
      },
      {
        id: "data",
        title: "Data and agreements",
        fields: [
          field("dataType", "What data would be involved?", "textarea", { rows: 4 }),
          field("containsPhi", "Does the data contain PHI or other identifiable information?", "radio", { options: YESNO.concat([["unsure", "Not sure"]]) }),
          field("irbStatus", "IRB status", "radio", { options: ["Approved", "Submitted", "Not yet submitted", "Not required", "Not sure"] }),
          field("duaNeeds", "Data-use agreement needs", "textarea", { rows: 3 })
        ]
      },
      { id: "interest", title: "Interests, statement, and availability", fields: INTEREST_FIELDS.concat(AVAILABILITY) },
      { id: "review", title: "Review and submit", kind: "review", fields: CERTIFY }
    ]
  },
  trainee: {
    id: "trainee",
    title: "Graduate & Medical Trainee Application",
    intro: "For PhD students, postdocs, medical students, and master's and other graduate students. This asks whether your skills fit, and whether you have enough time left here.",
    pages: [
      { id: "about", title: "About you", fields: ABOUT },
      {
        id: "program",
        title: "Program",
        fields: [
          field("program", "Program", "radio", { options: ["Postdoc", "PhD", "MD", "MD-PhD", "Master's", "Other graduate"] }),
          optional("programOther", "Name of the other graduate program", "text", { show: (a) => a.program === "Other graduate" }),
          field("programYear", "Year in program", "text", { hint: "For example, 2nd year or G3." }),
          field("endDate", "Expected graduation or appointment end date", "date")
        ]
      },
      {
        id: "appointment",
        title: "Your appointment",
        fields: [
          field("advisorName", "Advisor or PI name", "text", { show: (a) => isPhd(a) || isPostdoc(a) }),
          field("advisorApproval", "Does your advisor approve outside research?", "radio", { options: YESNO.concat([["discussing", "Still discussing"]]), show: (a) => isPhd(a) || isPostdoc(a) }),
          field("labRole", "How would you work with the lab?", "radio", {
            options: [
              "Lab Rotation",
              "Thesis or Dissertation Research",
              "Secondary / Cross-Disciplinary Project",
              "Medical / Clinical Research Block",
              "Graduate Course Credit / Capstone / Practicum",
              "Introductory Trainee Phase",
              "Visiting Scholar",
              "Other (Please specify below)"
            ]
          }),
          field("labRoleOther", "Please specify", "text", { show: (a) => a.labRole === "Other (Please specify below)" }),
          field("phdFunding", "Funding status", "text", { show: isPhd }),
          field("postdocFunding", "Funding source", "radio", { options: ["Fellowship", "PI grant", "Seeking a position"], show: isPostdoc }),
          field("postdocEnd", "Current appointment end date", "date", { show: isPostdoc }),
          optional("medRequirement", "Scholarly concentration or research-year requirement", "textarea", { rows: 3, show: isMedical }),
          optional("protectedTime", "Protected research time", "text", { show: isMedical }),
          optional("specialty", "Clinical specialty interest", "text", { show: isMedical })
        ]
      },
      {
        id: "skills",
        title: "Skills & Experience",
        fields: [
          optional("skills", "Proficiency scale", "skillgrid", {
            hint: "None. Beginner: coursework or basic familiarity. Intermediate: used independently in a project. Advanced: extensive experience or publication-level work. Each item also has Interested in learning.",
            groups: TRAINEE_SKILL_GROUPS,
            levels: PROFICIENCY
          }),
          optional("researchPortfolio", "Research Experience & Portfolio", "textarea", {
            hint: "Describe up to 3 projects that best show your skills. For each one, include:\nProject: title or a one-line description (research, coursework, hackathon, internship or independent projects all count)\nYour role & contribution: what you did\nTools & methods: languages, frameworks, techniques\nOutcome or link: publication, poster, GitHub repo, demo, report, etc.",
            rows: 12
          }),
          optional("ref1Name", "Reference name", "text", { span: true }),
          optional("ref1Email", "Reference email", "email", { span: true }),
          optional("ref1Relation", "Reference relationship", "text", { span: true })
        ]
      },
      { id: "interest", title: "Interests, statement, and availability", fields: INTEREST_FIELDS.concat(AVAILABILITY) },
      { id: "review", title: "Review and submit", kind: "review", fields: CERTIFY }
    ]
  },
  undergraduate: {
    id: "undergraduate",
    title: "Undergraduate Application",
    intro: "For undergraduates, including students on a premedical track.",
    pages: [
      { id: "about", title: "About you", fields: ABOUT },
      {
        id: "academics",
        title: "Academics",
        fields: [
          field("schoolYear", "Current year", "radio", { options: ["1st", "2nd", "3rd", "4th+"] }),
          field("gradDate", "Expected graduation date", "date"),
          field("major", "Major", "text"),
          optional("minor", "Minor", "text"),
          optional("gpa", "GPA", "radio", { options: ["Prefer not to say", "Below 3.0", "3.0–3.4", "3.5–3.7", "3.8–4.0"] }),
          field("courses", "Relevant courses taken", "textarea", { rows: 4 }),
          field("premed", "Are you on a premedical track?", "radio", { options: YESNO }),
          field("appCycle", "Planned medical school application cycle", "text", { show: isPremed }),
          field("gapYear", "Gap-year plans", "textarea", { rows: 3, show: isPremed }),
          field("clinicalGoals", "Clinical exposure goals", "textarea", { rows: 3, show: isPremed }),
          field("clinicalAi", "Interest in clinical-AI projects", "textarea", { rows: 3, show: isPremed })
        ]
      },
      {
        id: "goals",
        title: "Skills, goals, and time",
        fields: [
          field("skills", "Skills", "scale", { items: UNDERGRAD_SKILLS, options: LEVELS }),
          field("priorResearch", "Prior research or project experience", "textarea", { hint: "Class projects and hackathons count.", rows: 5 }),
          field("goals", "Goals", "checkboxes", { options: ["Learning", "Honors thesis", "Publication", "Graduate or medical school preparation", "Career exploration"] }),
          field("longTerm", "Longer-term interest", "checkboxes", { options: ["Course credit", "Federal Work-Study", "Summer internship", "Paid position"] }),
          field("workStudyAward", "Do you have a Federal Work-Study award?", "radio", { options: YESNO.concat([["unsure", "Not sure"]]), show: (a) => (a.longTerm || []).includes("Federal Work-Study") }),
          field("hoursPerWeek", "Hours per week", "number", { min: 1, max: 40, hint: "The lab generally looks for at least 8–10 hours a week." }),
          field("termAvailability", "Term-by-term availability", "textarea", { rows: 4 }),
          optional("facultyRef", "Faculty or TA reference", "text", { hint: "Optional at this stage. Name and email." })
        ]
      },
      { id: "interest", title: "Interests and statement", fields: INTEREST_FIELDS },
      {
        id: "review",
        title: "Review and submit",
        kind: "review",
        fields: CERTIFY
      }
    ]
  },
  transition: {
    id: "transition",
    title: "Volunteer Transition Request",
    internal: true,
    intro: "For current volunteers who have finished six months. This is the checkpoint for moving to credit, work-study, an internship, or a paid role.",
    pages: [
      {
        id: "period",
        title: "Your volunteer period",
        fields: [
          field("fullName", "Full name", "text"),
          field("email", "Email", "email"),
          field("volunteerStart", "Volunteer start date", "date"),
          field("monthsCompleted", "Months completed", "number", { min: 0, max: 120 }),
          field("mentorName", "Supervisor or mentor name", "text"),
          field("endorsement", "Mentor endorsement", "textarea", { hint: "Summarize your mentor's endorsement, or note that they will send it separately.", rows: 4 }),
          field("contributions", "Summary of contributions", "textarea", { hint: "Projects, code, data, and drafts.", rows: 6 })
        ]
      },
      {
        id: "request",
        title: "What you are requesting",
        fields: [
          field("requestedStatus", "Requested status", "radio", { options: ["Credit", "Work-study", "Internship", "Paid RA"] }),
          field("courseNumber", "Course number", "text", { show: wantsCredit }),
          field("units", "Units", "text", { show: wantsCredit }),
          field("hoursPerWeek", "Proposed hours per week", "number", { min: 1, max: 40 }),
          field("term", "Term", "text"),
          field("deliverables", "Proposed deliverables", "textarea", { rows: 4 }),
          optional("directorApproval", "Director approval", "text", { hint: "Leave blank. The director completes this." }),
          optional("directorDate", "Director approval date", "date")
        ]
      },
      { id: "review", title: "Review and submit", kind: "review", fields: CERTIFY }
    ]
  }
};

let _form = null;
let _answers = {};
let _files = {};
let _index = 0;
let _user = null;
let _role = "guest";
let _bound = false;

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function visible(item, answers) {
  return !item.show || item.show(answers);
}

function pageList() {
  const pages = [];
  for (const page of _form.pages) {
    if (page.kind === "exit") {
      if (visible(page, _answers)) {
        pages.push(page);
        break;
      }
      continue;
    }
    if (!visible(page, _answers)) continue;
    if (page.kind !== "review" && !(page.fields || []).some((item) => visible(item, _answers))) continue;
    pages.push(page);
  }
  return pages;
}

function optionPairs(options) {
  return (options || []).map((option) => Array.isArray(option) ? option : [option, option]);
}

function displayValue(item) {
  const value = _answers[item.key];
  if (item.type === "file") return _files[item.key]?.name || value || "";
  if (item.type === "checkbox") return value ? "Yes" : "";
  if (item.type === "checkboxes") return (value || []).join(", ");
  if (item.type === "scale") {
    return Object.entries(value || {}).filter(([, level]) => level).map(([name, level]) => `${name}: ${level}`).join("\n");
  }
  if (item.type === "skillgrid") return formatSkillAnswer(item);
  if (item.type === "radio") {
    const match = optionPairs(item.options).find(([id]) => id === value);
    return match ? match[1] : (value || "");
  }
  return value || "";
}

function validateField(item) {
  if (!visible(item, _answers)) return "";
  if (item.type === "skillgrid") return validateSkillGrid(item);
  const value = item.type === "file" ? _files[item.key] : _answers[item.key];
  if (item.requireAdvanced) {
    const advanced = Object.values(_answers.skills || {}).some((entry) => entry && entry.level === "Advanced");
    if (advanced && !String(value || "").trim()) return "Add your top 3 strengths, each with one line of proof or a link.";
  }
  const empty = item.type === "checkboxes" || item.type === "scale"
    ? !value || (Array.isArray(value) ? value.length === 0 : Object.values(value).filter(Boolean).length === 0)
    : item.type === "checkbox"
      ? value !== true
      : item.type === "file"
        ? !value
        : String(value || "").trim() === "";
  if (item.required && empty) return "This question is required.";
  if (item.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())) return "Enter a valid email address.";
  if (item.type === "scale" && item.required) {
    const picked = value || {};
    if (item.items.some((name) => !picked[name])) return "Rate every skill.";
  }
  if (!empty && item.minWords) {
    const count = wordCount(value);
    if (count < item.minWords || count > item.maxWords) return `Use ${item.minWords}–${item.maxWords} words. This is ${count}.`;
  }
  if (!empty && item.minLines) {
    const lines = String(value).split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < item.minLines) return `Add at least ${item.minLines}, one per line.`;
  }
  if (item.type === "file" && value) {
    const ok = /\.(pdf|docx?)$/i.test(value.name);
    if (!ok) return "Upload a PDF or Word file.";
    if (value.size > 10 * 1024 * 1024) return "That file is larger than 10 MB.";
  }
  return "";
}

function validatePage(page) {
  if (page.kind === "exit") return true;
  let ok = true;
  for (const item of page.fields || []) {
    const message = validateField(item);
    const slot = document.querySelector(`[data-error-for="${item.key}"]`);
    if (slot) {
      slot.textContent = message;
      slot.classList.toggle("visible", Boolean(message));
    }
    if (message) ok = false;
  }
  return ok;
}

function addLabel(group, item) {
  const label = document.createElement("label");
  label.htmlFor = `field-${item.key}`;
  label.append(document.createTextNode(item.label));
  if (item.required) {
    const mark = document.createElement("span");
    mark.className = "apply-required";
    mark.textContent = " *";
    label.append(mark);
  }
  group.append(label);
  if (item.hint) {
    const hint = document.createElement("span");
    hint.className = "apply-hint";
    hint.textContent = item.hint;
    group.append(hint);
  }
}

function addError(group, key) {
  const error = document.createElement("p");
  error.className = "form-error";
  error.dataset.errorFor = key;
  group.append(error);
}

function control(tag, item, attrs) {
  const el = document.createElement(tag);
  el.id = `field-${item.key}`;
  el.name = item.key;
  Object.entries(attrs || {}).forEach(([name, value]) => {
    if (value != null) el.setAttribute(name, value);
  });
  return el;
}

function renderChoice(group, item, kind) {
  const box = document.createElement("div");
  box.className = "apply-options";
  const selected = new Set(kind === "checkboxes" ? (_answers[item.key] || []) : [_answers[item.key]]);
  for (const [id, label] of optionPairs(item.options)) {
    const row = document.createElement("label");
    row.className = "apply-option";
    const input = document.createElement("input");
    input.type = kind === "checkboxes" ? "checkbox" : "radio";
    input.name = item.key;
    input.value = id;
    input.checked = selected.has(id);
    input.addEventListener("change", () => {
      if (kind === "checkboxes") {
        const next = new Set(_answers[item.key] || []);
        if (input.checked) next.add(id);
        else next.delete(id);
        _answers[item.key] = [...next];
      } else {
        _answers[item.key] = id;
      }
      render();
    });
    row.append(input, document.createTextNode(label));
    box.append(row);
  }
  group.append(box);
}

function skillName(skill) {
  return typeof skill === "string" ? skill : skill.name;
}

function skillItems(item) {
  return item.groups.flatMap((section) => section.items.filter((skill) => typeof skill === "string" || !skill.optional).map(skillName));
}

function formatSkillAnswer(item) {
  const value = _answers[item.key] || {};
  const groups = { Advanced: [], Intermediate: [], Beginner: [], learning: [] };
  const notes = [];
  for (const section of item.groups) {
    for (const skill of section.items) {
      const name = skillName(skill);
      const entry = value[name];
      if (!entry || (!entry.level && !entry.learn)) continue;
      const label = entry.detail ? `${name} (${entry.detail})` : name;
      if (groups[entry.level]) groups[entry.level].push(label);
      if (entry.learn) groups.learning.push(label);
    }
    if (section.checklist) {
      const picked = _answers[section.checklist.key] || [];
      if (picked.length) {
        const extra = String(_answers[section.checklist.otherKey] || "").trim();
        notes.push(`${section.checklist.label}: ${picked.join(", ")}${extra ? ` (${extra})` : ""}`);
      }
    }
  }
  return skillSummaryText(groups, notes);
}

function skillSummaryText(groups, notes) {
  const lines = [];
  const order = [
    ["Advanced", "Advanced"],
    ["Intermediate", "Intermediate"],
    ["Beginner", "Beginner"],
    ["learning", "Interested in learning"]
  ];
  for (const [key, label] of order) {
    if (groups[key]?.length) lines.push(`${label}: ${groups[key].join("; ")}`);
  }
  return lines.concat(notes || []).join("\n");
}

function skillTextFromAnswers(answers) {
  const skills = answers?.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) return "";
  const groups = { Advanced: [], Intermediate: [], Beginner: [], learning: [] };
  for (const [name, entry] of Object.entries(skills)) {
    if (typeof entry === "string") {
      if (groups[entry]) groups[entry].push(name);
      continue;
    }
    if (!entry || typeof entry !== "object" || (!entry.level && !entry.learn)) continue;
    const label = entry.detail ? `${name} (${entry.detail})` : name;
    if (groups[entry.level]) groups[entry.level].push(label);
    if (entry.learn) groups.learning.push(label);
  }
  const notes = [];
  const software = answers.statsSoftware;
  if (Array.isArray(software) && software.length) {
    const extra = String(answers.statsSoftwareOther || "").trim();
    notes.push(`Statistical software: ${software.join(", ")}${extra ? ` (${extra})` : ""}`);
  }
  return skillSummaryText(groups, notes);
}

function consumeSkillLine(groups, notes, line) {
  const single = line.match(/^(.*?):\s*(None|Beginner|Intermediate|Advanced)(?:,\s*interested in learning)?(?:,\s*(.+))?$/i);
  if (!single) {
    if (line && !/^None\b/i.test(line)) notes.push(line);
    return;
  }
  const label = single[3] ? `${single[1]} (${single[3]})` : single[1];
  const level = single[2].charAt(0).toUpperCase() + single[2].slice(1).toLowerCase();
  if (groups[level]) groups[level].push(label);
  if (/interested in learning/i.test(line)) groups.learning.push(label);
}

function parseSkillSummary(text) {
  const groups = { Advanced: [], Intermediate: [], Beginner: [], learning: [] };
  const notes = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const grouped = line.match(/^(Advanced|Intermediate|Beginner|Interested in learning):\s*(.+)$/);
    if (grouped) {
      const key = grouped[1] === "Interested in learning" ? "learning" : grouped[1];
      groups[key].push(...grouped[2].split(";").map((part) => part.trim()).filter(Boolean));
      continue;
    }
    for (const part of line.split(/;\s+/)) consumeSkillLine(groups, notes, part.trim());
  }
  return { groups, notes };
}

function fillSkillSummary(dd, text) {
  const { groups, notes } = parseSkillSummary(text);
  const order = [
    ["Advanced", "Advanced"],
    ["Intermediate", "Intermediate"],
    ["Beginner", "Beginner"],
    ["learning", "Interested in learning"]
  ];
  const shown = order.filter(([key]) => groups[key].length);
  if (!shown.length && !notes.length) {
    dd.textContent = "No skills rated above None.";
    return;
  }
  for (const [key, label] of shown) {
    const row = document.createElement("p");
    row.className = "apply-skill-sum";
    const title = document.createElement("strong");
    title.textContent = label;
    row.append(title, document.createTextNode(groups[key].join(" · ")));
    dd.append(row);
  }
  for (const note of notes) {
    const row = document.createElement("p");
    row.className = "apply-skill-sum";
    row.textContent = note;
    dd.append(row);
  }
}

function validateSkillGrid(item) {
  if (!item.required) return "";
  const value = _answers[item.key] || {};
  if (skillItems(item).some((name) => !value[name]?.level)) return "Rate every skill. Choose None if it does not apply.";
  return "";
}

function renderSkillGrid(group, item) {
  const read = (name) => (_answers[item.key] || {})[name] || { level: "", learn: false, detail: "" };
  const write = (name, patch) => {
    const current = _answers[item.key] || {};
    _answers[item.key] = { ...current, [name]: { ...read(name), ...patch } };
  };

  for (const section of item.groups) {
    const heading = document.createElement("h3");
    heading.className = "apply-skill-heading";
    heading.textContent = section.title;
    group.append(heading);

    const table = document.createElement("div");
    table.className = "apply-skill-table";
    for (const skill of section.items) {
      const name = skillName(skill);
      const entry = read(name);
      const row = document.createElement("div");
      row.className = "apply-skill-row";
      const label = document.createElement("span");
      label.textContent = name;
      const select = document.createElement("select");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Select";
      select.append(blank);
      for (const [id, text] of item.levels) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = text;
        select.append(option);
      }
      select.value = entry.level || "";
      const learnLabel = document.createElement("label");
      learnLabel.className = "apply-skill-learn";
      const learn = document.createElement("input");
      learn.type = "checkbox";
      learn.checked = !!entry.learn;
      learnLabel.append(learn, document.createTextNode("Interested in learning"));
      row.append(label, select, learnLabel);
      table.append(row);

      let detail = null;
      if (skill.detail) {
        detail = document.createElement("input");
        detail.type = "text";
        detail.className = "apply-skill-detail";
        detail.placeholder = skill.detail;
        detail.value = entry.detail || "";
        const syncDetail = () => {
          const next = read(name);
          detail.hidden = !((next.level && next.level !== "None") || next.learn);
        };
        detail.addEventListener("input", () => write(name, { detail: detail.value }));
        select.addEventListener("change", syncDetail);
        learn.addEventListener("change", syncDetail);
        syncDetail();
        table.append(detail);
      }
      select.addEventListener("change", () => write(name, { level: select.value }));
      learn.addEventListener("change", () => write(name, { learn: learn.checked }));
    }
    group.append(table);

    if (section.checklist) {
      const wrap = document.createElement("div");
      wrap.className = "apply-skill-software";
      const title = document.createElement("p");
      title.className = "apply-skill-software-label";
      title.textContent = section.checklist.label;
      const checks = document.createElement("div");
      checks.className = "apply-checks";
      const selected = new Set(_answers[section.checklist.key] || []);
      const other = document.createElement("input");
      other.type = "text";
      other.placeholder = "Other statistical software";
      other.value = _answers[section.checklist.otherKey] || "";
      other.hidden = !selected.has("Other");
      other.addEventListener("input", () => { _answers[section.checklist.otherKey] = other.value; });
      for (const name of section.checklist.options) {
        const choice = document.createElement("label");
        choice.className = "apply-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = selected.has(name);
        input.addEventListener("change", () => {
          const next = new Set(_answers[section.checklist.key] || []);
          if (input.checked) next.add(name);
          else next.delete(name);
          _answers[section.checklist.key] = [...next];
          if (name === "Other") other.hidden = !input.checked;
        });
        choice.append(input, document.createTextNode(name));
        checks.append(choice);
      }
      wrap.append(title, checks, other);
      group.append(wrap);
    }
  }
}

function renderScale(group, item) {
  const grid = document.createElement("div");
  grid.className = "apply-scale";
  const current = _answers[item.key] || {};
  for (const name of item.items) {
    const nameEl = document.createElement("span");
    nameEl.textContent = name;
    const select = document.createElement("select");
    select.innerHTML = `<option value="">Select</option>` + item.options.map((level) => `<option>${level}</option>`).join("");
    select.value = current[name] || "";
    select.addEventListener("change", () => {
      _answers[item.key] = { ...(_answers[item.key] || {}), [name]: select.value };
    });
    grid.append(nameEl, select);
  }
  group.append(grid);
}

function renderField(item) {
  const group = document.createElement("div");
  group.className = "form-group";
  const wide = ["textarea", "radio", "checkboxes", "checkbox", "file", "scale", "skillgrid"].includes(item.type);
  if (wide || item.span) group.classList.add("apply-span");

  const slot = document.createElement("div");
  slot.className = "apply-field-control";

  if (item.type !== "checkbox") {
    const head = document.createElement("div");
    head.className = "apply-field-head";
    addLabel(head, item);
    group.append(head);
  }

  if (item.type === "radio" || item.type === "checkboxes") {
    renderChoice(slot, item, item.type);
  } else if (item.type === "scale") {
    renderScale(slot, item);
  } else if (item.type === "skillgrid") {
    renderSkillGrid(slot, item);
  } else if (item.type === "checkbox") {
    const row = document.createElement("label");
    row.className = "apply-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `field-${item.key}`;
    input.checked = _answers[item.key] === true;
    input.addEventListener("change", () => { _answers[item.key] = input.checked; });
    row.append(input, document.createTextNode(item.label));
    slot.append(row);
  } else if (item.type === "textarea") {
    const input = control("textarea", item, { rows: item.rows || 5 });
    input.value = _answers[item.key] || "";
    input.addEventListener("input", () => {
      _answers[item.key] = input.value;
      const count = group.querySelector(".apply-count");
      if (count) count.textContent = `${wordCount(input.value)} words`;
    });
    slot.append(input);
    if (item.minWords) {
      const count = document.createElement("span");
      count.className = "apply-hint apply-count";
      count.textContent = `${wordCount(input.value)} words`;
      slot.append(count);
    }
  } else if (item.type === "file") {
    const input = control("input", item, { type: "file", accept: item.accept || "" });
    input.addEventListener("change", () => {
      _files[item.key] = input.files[0] || null;
      _answers[item.key] = _files[item.key]?.name || "";
    });
    slot.append(input);
    if (_files[item.key]) {
      const current = document.createElement("span");
      current.className = "apply-hint";
      current.textContent = _files[item.key].name;
      slot.append(current);
    }
  } else {
    const input = control("input", item, { type: item.type || "text", min: item.min, max: item.max });
    input.value = _answers[item.key] || "";
    input.addEventListener("input", () => { _answers[item.key] = input.value; });
    slot.append(input);
  }
  addError(slot, item.key);
  group.append(slot);
  return group;
}

function renderReview(body, page) {
  const list = document.createElement("div");
  list.className = "apply-review";
  for (const source of pageList()) {
    if (source.kind === "review" || source.kind === "exit") continue;
    for (const item of source.fields || []) {
      if (!visible(item, _answers) || item.type === "checkbox") continue;
      const value = displayValue(item);
      if (!value) continue;
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = item.label;
      const dd = document.createElement("dd");
      if (item.type === "skillgrid" || item.key === "skills") fillSkillSummary(dd, value);
      else dd.textContent = value;
      row.append(dt, dd);
      list.append(row);
    }
  }
  body.append(list);
  const grid = document.createElement("div");
  grid.className = "apply-grid";
  for (const item of page.fields || []) {
    if (visible(item, _answers)) grid.append(renderField(item));
  }
  body.append(grid);
}

function render() {
  const pages = pageList();
  if (_index >= pages.length) _index = Math.max(0, pages.length - 1);
  const page = pages[_index];
  const root = document.getElementById("apply-root");
  const gate = document.getElementById("apply-gate");
  const form = document.getElementById("apply-form");
  const done = document.getElementById("apply-done");
  if (_form.internal && !hasRole(_role, "regular")) {
    root.hidden = true;
    done.hidden = true;
    document.getElementById("apply-card").hidden = true;
    gate.hidden = false;
    return;
  }
  document.getElementById("apply-card").hidden = false;
  gate.hidden = true;
  done.hidden = true;
  root.hidden = false;
  form.hidden = false;

  document.getElementById("apply-kicker").textContent = _form.internal ? "Internal" : "Join Us";
  document.getElementById("apply-title").textContent = _form.title;
  document.getElementById("apply-intro").textContent = _form.intro;
  document.title = `${_form.title} · Multimodal Intelligence Lab`;
  const progress = document.getElementById("apply-progress-bar");
  progress.style.width = `${(( _index + 1) / pages.length) * 100}%`;
  document.getElementById("apply-step").textContent = `Section ${_index + 1} of ${pages.length}`;
  document.getElementById("apply-page-title").textContent = page.title;

  const body = document.getElementById("apply-body");
  body.replaceChildren();
  if (page.kind === "exit") {
    const copy = document.createElement("p");
    copy.className = "apply-exit";
    copy.textContent = typeof page.body === "function" ? page.body(_answers) : page.body;
    body.append(copy);
  } else if (page.kind === "review") {
    renderReview(body, page);
  } else {
    const grid = document.createElement("div");
    grid.className = "apply-grid";
    for (const item of page.fields || []) {
      if (visible(item, _answers)) grid.append(renderField(item));
    }
    body.append(grid);
  }

  const last = _index === pages.length - 1 && page.kind !== "exit";
  document.getElementById("apply-back").hidden = _index === 0;
  document.getElementById("apply-next").hidden = last || page.kind === "exit";
  document.getElementById("apply-submit").hidden = !last;
  document.getElementById("apply-error").textContent = "";
  document.getElementById("apply-error").classList.remove("visible");
}

function showError(message) {
  const error = document.getElementById("apply-error");
  error.textContent = message;
  error.classList.add("visible");
  error.scrollIntoView({ block: "nearest" });
}

function fileType(file) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".doc")) return "application/msword";
  return file.type || "application/pdf";
}

function columnValue(value) {
  if (Array.isArray(value)) return value.join("; ");
  if (value && typeof value === "object") {
    return Object.entries(value).filter(([, level]) => level).map(([name, level]) => `${name}: ${level}`).join("; ");
  }
  if (value === true) return "Yes";
  if (value === false) return "No";
  return value == null ? "" : String(value);
}

function buildColumns(cvUrl) {
  const columns = { form: _form.title, formType: _form.id, cvUrl: cvUrl || "" };
  for (const page of _form.pages) {
    for (const item of page.fields || []) {
      columns[item.key] = item.type === "skillgrid" ? formatSkillAnswer(item) : columnValue(_answers[item.key]);
    }
  }
  columns.cv = _files.cv?.name || "";
  return columns;
}

async function submitApplication() {
  const page = pageList()[_index];
  if (!validatePage(page)) return;
  const button = document.getElementById("apply-submit");
  button.disabled = true;
  button.textContent = "Submitting…";
  try {
    const record = doc(collection(db, "applications"));
    let cvUrl = "";
    const file = _files.cv;
    if (file) {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const stored = ref(storage, `applications/${record.id}/${Date.now()}-${safe}`);
      await uploadBytes(stored, file, { contentType: fileType(file) });
      cvUrl = await getDownloadURL(stored);
    }
    const answers = { ..._answers };
    delete answers.cv;
    await setDoc(record, {
      formType: _form.id,
      formTitle: _form.title,
      emailLower: String(answers.email || "").trim().toLowerCase(),
      answers,
      columns: buildColumns(cvUrl),
      cvUrl,
      cvName: file?.name || "",
      submittedAt: serverTimestamp()
    });
    document.getElementById("apply-form").hidden = true;
    const done = document.getElementById("apply-done");
    done.hidden = false;
    done.querySelector("h2").textContent = "Application submitted";
    done.querySelector("p").textContent = "We read every application. Please allow 2 weeks for a response. Sending a complete application through the correct form is the fastest way to be considered.";
  } catch (error) {
    const code = error?.code || "";
    const message = code === "storage/unauthorized"
      ? "The CV could not be saved. Upload a PDF or Word file and try again."
      : code === "permission-denied"
        ? "The application could not be saved. Try again."
        : (error?.message || "The application could not be saved. Try again.");
    showError(message);
    button.disabled = false;
    button.textContent = "Submit application";
  }
}

async function loadSubmissions() {
  const list = document.getElementById("apply-admin-list");
  list.hidden = false;
  list.textContent = "Loading…";
  try {
    const snap = await getDocs(query(collection(db, "applications"), orderBy("submittedAt", "desc"), limit(50)));
    const rows = snap.docs.map((item) => item.data()).filter((item) => item.formType === _form.id);
    if (!rows.length) {
      list.textContent = "No submissions for this form yet.";
      return;
    }
    list.replaceChildren();
    for (const row of rows) {
      const details = document.createElement("details");
      details.className = "apply-admin-row";
      const summary = document.createElement("summary");
      const who = row.columns?.fullName || row.answers?.fullName || "Untitled";
      const email = row.columns?.email || row.answers?.email || "";
      summary.textContent = `${who} · ${email}`;
      const dl = document.createElement("dl");
      const columns = row.columns || {};
      const skillBlob = skillTextFromAnswers(row.answers) || columns.skills || "";
      Object.keys(columns).forEach((key) => {
        if (key === "statsSoftware" || key === "statsSoftwareOther") return;
        if (key === "skills") {
          if (!skillBlob) return;
          const dt = document.createElement("dt");
          dt.textContent = "Skills";
          const dd = document.createElement("dd");
          fillSkillSummary(dd, skillBlob);
          dl.append(dt, dd);
          return;
        }
        if (!columns[key]) return;
        const dt = document.createElement("dt");
        dt.textContent = key;
        const dd = document.createElement("dd");
        dd.textContent = String(columns[key]);
        dl.append(dt, dd);
      });
      details.append(summary, dl);
      list.append(details);
    }
  } catch (error) {
    list.textContent = error?.message || "Could not load submissions.";
  }
}

function bind() {
  if (_bound) return;
  _bound = true;
  document.getElementById("apply-back").addEventListener("click", () => {
    _index = Math.max(0, _index - 1);
    render();
    document.getElementById("apply-card").scrollIntoView({ block: "start" });
  });
  document.getElementById("apply-next").addEventListener("click", () => {
    const page = pageList()[_index];
    if (!validatePage(page)) return;
    _index += 1;
    render();
    document.getElementById("apply-card").scrollIntoView({ block: "start" });
  });
  document.getElementById("apply-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const page = pageList()[_index];
    if (page?.kind === "exit") return;
    if (page?.kind === "review") submitApplication();
    else document.getElementById("apply-next").click();
  });
  document.getElementById("apply-admin-toggle").addEventListener("click", loadSubmissions);
}

export async function initApply(user, role) {
  _user = user;
  _role = role || "guest";
  const id = new URLSearchParams(location.search).get("form");
  _form = FORMS[id] || null;
  const missing = document.getElementById("apply-missing");
  if (!_form) {
    missing.hidden = false;
    document.getElementById("apply-card").hidden = true;
    document.getElementById("apply-root").hidden = true;
    return;
  }
  missing.hidden = true;
  document.getElementById("apply-card").hidden = false;
  if (_form.id === "transition" && user) {
    _answers.email = _answers.email || user.email || "";
    _answers.fullName = _answers.fullName || user.displayName || "";
  }
  bind();
  render();
  document.getElementById("apply-admin").hidden = !hasRole(_role, "admin");
}
