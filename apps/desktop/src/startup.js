const api = window.superCanvasDesktop;
function state(value) {
  document.querySelector('#message').textContent = value.message;
  document.querySelector('#detail').textContent = value.detail || '';
  document.querySelector('#actions').hidden = value.phase !== 'setup';
  document.querySelector('#retry').hidden = value.phase !== 'error';
  for (const button of document.querySelectorAll('[data-action]')) button.disabled = false;
}
api.onState(state);
for (const button of document.querySelectorAll('[data-action]')) button.onclick = async () => {
  for (const item of document.querySelectorAll('[data-action]')) item.disabled = true;
  try { await api.initialize(button.dataset.action); } catch (error) { state({ phase: 'setup', message: '迁移未完成', detail: error.message }); }
};
document.querySelector('#logs').onclick = () => api.openLogs();
document.querySelector('#retry').onclick = () => api.retry();
