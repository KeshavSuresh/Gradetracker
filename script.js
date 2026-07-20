// ---------- State ----------

const STORAGE_KEY = "ledger-grades-v1";

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not read saved data, starting fresh.", e);
  }
  return {
    scale: "4.0",
    showLetters: true,
    classes: [],
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- Grade math ----------

const LETTER_TABLE = [
  { min: 93, letter: "A", points: 4.0 },
  { min: 90, letter: "A-", points: 3.7 },
  { min: 87, letter: "B+", points: 3.3 },
  { min: 83, letter: "B", points: 3.0 },
  { min: 80, letter: "B-", points: 2.7 },
  { min: 77, letter: "C+", points: 2.3 },
  { min: 73, letter: "C", points: 2.0 },
  { min: 70, letter: "C-", points: 1.7 },
  { min: 67, letter: "D+", points: 1.3 },
  { min: 63, letter: "D", points: 1.0 },
  { min: 60, letter: "D-", points: 0.7 },
  { min: -Infinity, letter: "F", points: 0.0 },
];

function percentToLetter(pct) {
  if (pct === null) return null;
  const row = LETTER_TABLE.find((r) => pct >= r.min);
  return row.letter;
}

function percentToPoints(pct, honors, scale) {
  if (pct === null) return null;
  const row = LETTER_TABLE.find((r) => pct >= r.min);
  let points = row.points;
  if (scale === "5.0" && honors && points > 0) {
    points = Math.min(points + 1.0, 5.0);
  }
  return points;
}

// Returns { percent, letter, points } or nulls if no data yet
function calcClassGrade(cls, scale, hypothetical) {
  // hypothetical: optional { categoryId, score, max } to include as an extra assignment
  const categories = cls.categories.map((cat) => {
    const assignments = cat.assignments.slice();
    if (hypothetical && hypothetical.categoryId === cat.id) {
      assignments.push({ score: hypothetical.score, max: hypothetical.max });
    }
    return { ...cat, assignments };
  });

  const withData = categories.filter((c) => c.assignments.length > 0);
  if (withData.length === 0) return { percent: null, letter: null, points: null };

  const weightsGiven = withData.some((c) => Number(c.weight) > 0);

  let percent;
  if (weightsGiven) {
    let weightSum = 0;
    let weightedSum = 0;
    withData.forEach((c) => {
      const w = Number(c.weight) || 0;
      const totalScore = c.assignments.reduce((s, a) => s + Number(a.score || 0), 0);
      const totalMax = c.assignments.reduce((s, a) => s + Number(a.max || 0), 0);
      const avg = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
      weightedSum += avg * w;
      weightSum += w;
    });
    percent = weightSum > 0 ? weightedSum / weightSum : null;
  } else {
    // simple total-points average across all assignments, ignoring category boundaries
    let totalScore = 0;
    let totalMax = 0;
    withData.forEach((c) => {
      c.assignments.forEach((a) => {
        totalScore += Number(a.score || 0);
        totalMax += Number(a.max || 0);
      });
    });
    percent = totalMax > 0 ? (totalScore / totalMax) * 100 : null;
  }

  if (percent === null) return { percent: null, letter: null, points: null };

  const letter = percentToLetter(percent);
  const points = percentToPoints(percent, cls.honors, scale);
  return { percent, letter, points };
}

function calcOverallGPA(classes, scale) {
  const grades = classes
    .map((c) => calcClassGrade(c, scale))
    .filter((g) => g.percent !== null);
  if (grades.length === 0) return null;

  if (scale === "percent") {
    const avg = grades.reduce((s, g) => s + g.percent, 0) / grades.length;
    return { display: avg.toFixed(1) + "%", raw: avg };
  }
  const avgPoints = grades.reduce((s, g) => s + g.points, 0) / grades.length;
  const cap = scale === "5.0" ? 5.0 : 4.0;
  return { display: Math.min(avgPoints, cap).toFixed(2), raw: avgPoints };
}

// ---------- Rendering ----------

const classListEl = document.getElementById("classList");
const classCardTpl = document.getElementById("classCardTemplate");
const categoryTpl = document.getElementById("categoryTemplate");
const assignmentTpl = document.getElementById("assignmentTemplate");

function render() {
  document.getElementById("scaleSelect").value = state.scale;
  document.getElementById("showLetters").checked = state.showLetters;

  const gpa = calcOverallGPA(state.classes, state.scale);
  document.getElementById("gpaValue").textContent = gpa ? gpa.display : "—";
  document.getElementById("gpaScaleLabel").textContent =
    state.scale === "percent" ? "class average" : state.scale + " scale";

  classListEl.innerHTML = "";
  state.classes.forEach((cls) => classListEl.appendChild(renderClassCard(cls)));

  saveState();
}

function renderClassCard(cls) {
  const node = classCardTpl.content.firstElementChild.cloneNode(true);

  const nameInput = node.querySelector(".class-name-input");
  nameInput.value = cls.name;
  nameInput.addEventListener("input", (e) => {
    cls.name = e.target.value;
    saveState();
  });

  const honorsCheck = node.querySelector(".honors-check");
  honorsCheck.checked = cls.honors;
  honorsCheck.addEventListener("change", (e) => {
    cls.honors = e.target.checked;
    render();
  });

  node.querySelector(".delete-class-btn").addEventListener("click", () => {
    if (confirm(`Delete "${cls.name || "this class"}"? This can't be undone.`)) {
      state.classes = state.classes.filter((c) => c.id !== cls.id);
      render();
    }
  });

  const grade = calcClassGrade(cls, state.scale);
  const letterEl = node.querySelector(".grade-letter");
  const percentEl = node.querySelector(".grade-percent");
  if (grade.percent === null) {
    letterEl.textContent = "—";
    percentEl.textContent = "no grades yet";
  } else {
    letterEl.textContent = state.showLetters ? grade.letter : grade.percent.toFixed(1) + "%";
    percentEl.textContent = state.showLetters ? grade.percent.toFixed(1) + "%" : "";
    letterEl.classList.toggle("is-passing", grade.percent >= 70);
  }

  // categories
  const catListEl = node.querySelector(".category-list");
  cls.categories.forEach((cat) => catListEl.appendChild(renderCategory(cls, cat)));

  node.querySelector(".add-category-btn").addEventListener("click", () => {
    cls.categories.push({ id: uid(), name: "", weight: "", assignments: [] });
    render();
  });

  // weight warning
  const totalWeight = cls.categories.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const warn = node.querySelector(".weight-warning");
  if (cls.categories.length > 0 && totalWeight > 0 && Math.abs(totalWeight - 100) > 0.5) {
    warn.hidden = false;
    warn.textContent = `Weights add up to ${totalWeight}%, not 100% — grade is scaled proportionally.`;
  }

  // what-if
  const whatifPanel = node.querySelector(".whatif-panel");
  const whatifToggle = node.querySelector(".whatif-toggle-btn");
  whatifToggle.addEventListener("click", () => {
    whatifPanel.hidden = !whatifPanel.hidden;
  });

  const whatifCategorySelect = node.querySelector(".whatif-category");
  cls.categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name || "(unnamed category)";
    whatifCategorySelect.appendChild(opt);
  });
  if (cls.categories.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "Add a category first";
    opt.disabled = true;
    whatifCategorySelect.appendChild(opt);
  }

  node.querySelector(".whatif-run-btn").addEventListener("click", () => {
    const categoryId = whatifCategorySelect.value;
    const score = Number(node.querySelector(".whatif-score").value);
    const max = Number(node.querySelector(".whatif-max").value) || 100;
    const resultEl = node.querySelector(".whatif-result");

    if (!categoryId || Number.isNaN(score)) {
      resultEl.textContent = "Enter a score to see the result.";
      return;
    }

    const current = calcClassGrade(cls, state.scale);
    const hypo = calcClassGrade(cls, state.scale, { categoryId, score, max });

    if (hypo.percent === null) {
      resultEl.textContent = "Not enough data to calculate.";
      return;
    }

    const currentTxt = current.percent === null ? "no grade yet" : current.percent.toFixed(1) + "%";
    const diff = current.percent === null ? null : hypo.percent - current.percent;
    const diffTxt = diff === null ? "" : diff >= 0 ? ` (+${diff.toFixed(1)})` : ` (${diff.toFixed(1)})`;

    resultEl.textContent =
      `Scoring ${score}/${max} there → new grade: ${hypo.percent.toFixed(1)}% (${hypo.letter})` +
      ` — up from ${currentTxt}${diffTxt}`;
  });

  return node;
}

function renderCategory(cls, cat) {
  const node = categoryTpl.content.firstElementChild.cloneNode(true);

  const nameInput = node.querySelector(".category-name-input");
  nameInput.value = cat.name;
  nameInput.addEventListener("input", (e) => {
    cat.name = e.target.value;
    saveState();
  });

  const weightInput = node.querySelector(".category-weight-input");
  weightInput.value = cat.weight;
  weightInput.addEventListener("input", (e) => {
    cat.weight = e.target.value;
    render();
  });

  node.querySelector(".delete-category-btn").addEventListener("click", () => {
    cls.categories = cls.categories.filter((c) => c.id !== cat.id);
    render();
  });

  const assignmentListEl = node.querySelector(".assignment-list");
  cat.assignments.forEach((a) => assignmentListEl.appendChild(renderAssignment(cat, a)));

  node.querySelector(".add-assignment-btn").addEventListener("click", () => {
    cat.assignments.push({ id: uid(), name: "", score: "", max: 100 });
    render();
  });

  return node;
}

function renderAssignment(cat, a) {
  const node = assignmentTpl.content.firstElementChild.cloneNode(true);

  const nameInput = node.querySelector(".assignment-name-input");
  nameInput.value = a.name;
  nameInput.addEventListener("input", (e) => {
    a.name = e.target.value;
    saveState();
  });

  const scoreInput = node.querySelector(".assignment-score-input");
  scoreInput.value = a.score;
  scoreInput.addEventListener("input", (e) => {
    a.score = e.target.value;
    renderGradesOnly();
  });

  const maxInput = node.querySelector(".assignment-max-input");
  maxInput.value = a.max;
  maxInput.addEventListener("input", (e) => {
    a.max = e.target.value;
    renderGradesOnly();
  });

  node.querySelector(".delete-assignment-btn").addEventListener("click", () => {
    cat.assignments = cat.assignments.filter((x) => x.id !== a.id);
    render();
  });

  return node;
}

// Lightweight re-render that keeps focus stable when just typing scores.
function renderGradesOnly() {
  saveState();
  updateAllGradeDisplays();
}

function updateAllGradeDisplays() {
  const gpa = calcOverallGPA(state.classes, state.scale);
  document.getElementById("gpaValue").textContent = gpa ? gpa.display : "—";

  document.querySelectorAll(".class-card").forEach((node, idx) => {
    const cls = state.classes[idx];
    if (!cls) return;
    const grade = calcClassGrade(cls, state.scale);
    const letterEl = node.querySelector(".grade-letter");
    const percentEl = node.querySelector(".grade-percent");
    if (grade.percent === null) {
      letterEl.textContent = "—";
      percentEl.textContent = "no grades yet";
      letterEl.classList.remove("is-passing");
    } else {
      letterEl.textContent = state.showLetters ? grade.letter : grade.percent.toFixed(1) + "%";
      percentEl.textContent = state.showLetters ? grade.percent.toFixed(1) + "%" : "";
      letterEl.classList.toggle("is-passing", grade.percent >= 70);
    }
  });
}

// ---------- Top-level controls ----------

document.getElementById("addClassBtn").addEventListener("click", () => {
  state.classes.push({
    id: uid(),
    name: "",
    honors: false,
    categories: [],
  });
  render();
});

document.getElementById("scaleSelect").addEventListener("change", (e) => {
  state.scale = e.target.value;
  render();
});

document.getElementById("showLetters").addEventListener("change", (e) => {
  state.showLetters = e.target.checked;
  render();
});

// ---------- Init ----------

render();
