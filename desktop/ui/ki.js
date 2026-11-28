/* KI-Seitenleiste: Kopfleiste (Anbieter wählen, Seite zusammenfassen, schließen). Spricht über window.chrome2 mit Sakura. */
const api = window.chrome2;
const $ = s => document.querySelector(s);
let st = null;
async function refresh() {
  st = await api.call('kiState');
  if (!st) return;
  $('#prov-name').textContent = (st.providers.find(p => p.id === st.provider) || st.providers[0]).label;
  if (st.theme) for (const [k, v] of Object.entries(st.theme)) document.documentElement.style.setProperty(k, v);
}
$('#prov').onclick = () => {
  const m = $('#menu');
  if (!m.hidden) { m.hidden = true; api.call('kiMenu', false); return; }
  m.innerHTML = '';
  for (const p of st.providers) {
    const b = document.createElement('button');
    b.textContent = p.label;
    if (p.id === st.provider) b.className = 'on';
    b.onclick = async () => { m.hidden = true; api.call('kiMenu', false); await api.call('kiProvider', p.id); refresh(); };
    m.appendChild(b);
  }
  m.hidden = false;
  api.call('kiMenu', true); // Kopfleiste kurz größer, damit das Menü Platz hat
};
$('#sum').onclick = () => api.call('kiSummarize');
$('#close').onclick = () => api.call('kiToggle', false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#menu').hidden) { $('#menu').hidden = true; api.call('kiMenu', false); } });
api.on('state', refresh);
refresh();
