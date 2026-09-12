const TOTAL_QUESTIONS = 21;
const TOTAL_TIME = 900;
const SESSION_KEY = 'family_grace_active_quiz';
const config = window.FG_SUPABASE || {};
const quizClient = config.url && config.publishableKey && window.supabase
  ? window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  : null;

const state = {
  player: null,
  token: null,
  questions: [],
  answers: [],
  startedAt: null,
  timer: null,
  submitting: false,
  submitted: false,
  autoSubmitAttempted: false
};

const byId = id => document.getElementById(id);
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function setStartStatus(message, isError = false) {
  const target = byId('startStatus');
  target.textContent = message;
  target.style.color = isError ? '#b42318' : '#285d9a';
}

function setFieldError(inputId, errorId, message) {
  const input = byId(inputId);
  const error = byId(errorId);
  input.classList.toggle('error', Boolean(message));
  error.textContent = message;
  error.classList.toggle('show', Boolean(message));
}

function validateRegistration() {
  const name = byId('playerName').value.trim();
  const code = byId('playerCode').value.trim().toUpperCase();
  const email = byId('playerEmail').value.trim();
  setFieldError('playerName', 'nameError', name ? '' : 'Full name is required');
  setFieldError('playerCode', 'codeError', code ? '' : 'Access code is required');
  setFieldError('playerEmail', 'emailError', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'Enter a valid email address');
  if (!name || !code || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name, code, email };
}

function updateTimer() {
  if (!state.startedAt || state.submitted) return;
  const elapsed = Math.min(TOTAL_TIME, Math.floor((Date.now() - state.startedAt) / 1000));
  const remaining = TOTAL_TIME - elapsed;
  byId('timeDisplay').textContent = formatTime(remaining);
  byId('elapsedDisplay').textContent = formatTime(elapsed);
  byId('timerBox').classList.toggle('warning', remaining <= 300 && remaining > 60);
  byId('timerBox').classList.toggle('danger', remaining <= 60);
  const progress = byId('progressFill');
  const percent = Math.round(remaining / TOTAL_TIME * 100);
  progress.style.width = `${percent}%`;
  progress.setAttribute('aria-valuenow', percent);
  if (remaining === 0 && !state.submitting && !state.autoSubmitAttempted) {
    state.autoSubmitAttempted = true;
    submitQuiz(true);
  }
}

function renderQuiz() {
  const form = byId('quizForm');
  form.replaceChildren();
  state.questions.forEach((question, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    const number = document.createElement('div');
    number.className = 'question-number';
    number.textContent = `Question ${index + 1} of ${TOTAL_QUESTIONS}`;
    const title = document.createElement('div');
    title.className = 'question-text';
    title.textContent = question.q;
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'question-options';
    fieldset.setAttribute('aria-label', `Question ${index + 1} answers`);
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement('label');
      label.className = 'option-label';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `question_${index}`;
      input.value = String(optionIndex);
      input.addEventListener('change', () => {
        state.answers[index] = optionIndex;
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, answers: state.answers })); } catch (_) { /* Session storage may be unavailable. */ }
        card.classList.add('answered');
        byId('answeredCount').textContent = `${state.answers.filter(value => value !== null).length}/${TOTAL_QUESTIONS}`;
      });
      const text = document.createElement('span');
      text.className = 'option-text';
      text.textContent = option;
      label.append(input, text);
      fieldset.appendChild(label);
    });
    card.append(number, title, fieldset);
    form.appendChild(card);
  });
}

async function beginQuiz() {
  const player = validateRegistration();
  if (!player || state.token) return;
  if (!quizClient) {
    setStartStatus('The quiz service did not load. Check your internet connection and refresh.', true);
    return;
  }
  const button = byId('startBtn');
  button.disabled = true;
  setStartStatus('Checking your access code and preparing the quiz...');
  try {
    const { data, error } = await quizClient.rpc('family_grace_start_quiz', {
      p_name: player.name,
      p_email: player.email,
      p_code: player.code
    });
    if (error) throw error;
    if (!data?.token || !Array.isArray(data.questions) || data.questions.length !== TOTAL_QUESTIONS) {
      throw new Error('The quiz service returned an incomplete session.');
    }
    state.player = player;
    state.token = data.token;
    state.questions = data.questions;
    state.answers = Array(TOTAL_QUESTIONS).fill(null);
    state.startedAt = Date.now();
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, answers: state.answers })); } catch (_) { /* Session storage may be unavailable. */ }
    renderQuiz();
    byId('quizMain').style.display = 'block';
    byId('loginModal').hidden = true;
    updateTimer();
    state.timer = setInterval(updateTimer, 250);
  } catch (error) {
    setStartStatus(error.message || 'Could not start the quiz. Please try again.', true);
    button.disabled = false;
  }
}

async function submitQuiz(autoSubmit = false) {
  if (!state.token || state.submitting || state.submitted) return;
  state.submitting = true;
  const button = byId('submitBtn');
  button.disabled = true;
  byId('syncStatus').textContent = 'Submitting answers for secure scoring...';
  try {
    const { data, error } = await quizClient.rpc('family_grace_submit_quiz', {
      p_token: state.token,
      p_answers: state.answers
    });
    if (error) throw error;
    state.submitted = true;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* Session storage may be unavailable. */ }
    clearInterval(state.timer);
    byId('timeDisplay').textContent = formatTime(TOTAL_TIME - data.time_seconds);
    byId('elapsedDisplay').textContent = formatTime(data.time_seconds);
    byId('quizForm').querySelectorAll('input').forEach(input => { input.disabled = true; });
    const result = byId('resultMessage');
    result.className = `alert show ${autoSubmit ? 'alert-info' : 'alert-success'}`;
    result.replaceChildren();
    const title = document.createElement('div');
    title.className = 'alert-title';
    title.textContent = autoSubmit ? 'Time is up. Your quiz was submitted.' : 'Quiz submitted successfully.';
    const detail = document.createElement('div');
    detail.textContent = `Your answers were received in ${formatTime(data.time_seconds)}. The organizer can view your result in the admin dashboard.`;
    result.append(title, detail);
    byId('syncStatus').textContent = 'Your result is saved in the admin dashboard.';
  } catch (error) {
    byId('syncStatus').textContent = `Result was not saved: ${error.message || 'please retry'}`;
    button.disabled = false;
  } finally {
    state.submitting = false;
  }
}

async function resumeQuiz() {
  if (!quizClient) return;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return; }
  if (!saved?.token) return;
  setStartStatus('Restoring your quiz session...');
  const { data, error } = await quizClient.rpc('family_grace_resume_quiz', { p_token: saved.token });
  if (error || !data?.questions || data.questions.length !== TOTAL_QUESTIONS) {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* Ignore. */ }
    setStartStatus('The earlier quiz session could not be restored. Contact the organizer if your code was already used.', true);
    return;
  }
  state.token = saved.token;
  state.questions = data.questions;
  state.answers = Array.from({ length: TOTAL_QUESTIONS }, (_, index) => {
    const value = saved.answers?.[index];
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
  });
  state.startedAt = Date.now() - (TOTAL_TIME - data.remaining_seconds) * 1000;
  renderQuiz();
  state.answers.forEach((answer, index) => {
    if (answer === null) return;
    const input = byId('quizForm').querySelector(`input[name="question_${index}"][value="${answer}"]`);
    if (input) { input.checked = true; input.closest('.question-card').classList.add('answered'); }
  });
  byId('answeredCount').textContent = `${state.answers.filter(answer => answer !== null).length}/${TOTAL_QUESTIONS}`;
  byId('quizMain').style.display = 'block';
  byId('loginModal').hidden = true;
  updateTimer();
  state.timer = setInterval(updateTimer, 250);
}

document.addEventListener('DOMContentLoaded', () => {
  byId('year').textContent = new Date().getFullYear();
  byId('loginForm').addEventListener('submit', event => { event.preventDefault(); beginQuiz(); });
  byId('startBtn').addEventListener('click', beginQuiz);
  byId('submitBtn').addEventListener('click', () => submitQuiz(false));
  document.addEventListener('visibilitychange', updateTimer);
  resumeQuiz();
});
