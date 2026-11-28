/* Spiele-Overlay: Kopfleiste (Deckkraft, Durchklicken, zurück in den Tab). Spricht über window.chrome2 mit Sakura. */
const api = window.chrome2;
const $ = s => document.querySelector(s);
async function refresh() {
  const st = await api.call('overlayState');
  if (!st) return;
  if (st.theme) for (const [k, v] of Object.entries(st.theme)) document.documentElement.style.setProperty(k, v);
  $('#title').textContent = st.title || 'Spiele-Overlay';
  $('#op').value = st.opacity; $('#op-v').textContent = st.opacity + ' %';
}
let t = null;
$('#op').oninput = e => {
  $('#op-v').textContent = e.target.value + ' %';
  clearTimeout(t); t = setTimeout(() => api.call('overlayCmd', { act: 'opacity', value: Number(e.target.value) }), 60);
};
$('#through').onclick = () => api.call('overlayCmd', { act: 'through' });
$('#back').onclick = () => api.call('overlayCmd', { act: 'back' });
api.on('overlay-refresh', refresh);
refresh();
