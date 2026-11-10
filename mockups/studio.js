const canvas = document.querySelector('#canvas');
const frames = [...document.querySelectorAll('iframe')];
function setView(view) {
  canvas.className = view;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  document.querySelector('#frame-label').textContent = {desktop:'Desktop · responsive', mobile:'Mobile · 390 × 844', compare:'Desktop + mobile · scroll canvas'}[view];
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelector('#screen').addEventListener('change', e => frames.forEach(f => f.contentWindow.postMessage({type:'ebp-preview-screen', screen:e.target.value}, location.protocol === 'file:' ? '*' : location.origin)));
const notes = document.querySelector('#notes');
function showNotes(show) { notes.hidden = !show; document.querySelector('#notes-toggle').setAttribute('aria-expanded', String(show)); if(show) document.querySelector('#notes-close').focus(); else document.querySelector('#notes-toggle').focus(); }
document.querySelector('#notes-toggle').onclick = () => showNotes(notes.hidden);
document.querySelector('#notes-close').onclick = () => showNotes(false);
document.addEventListener('keydown', e => {if(e.key === 'Escape' && !notes.hidden) showNotes(false);});
if (innerWidth < 700) setView('mobile');
