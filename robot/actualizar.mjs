// Robot de "Mesa de Obras por Impuestos" (Vibras Positivas HM)
// Corre en GitHub Actions cada 30 minutos. Trae noticias reales de Obras por
// Impuestos en Colombia (Google News y Bing) con su foto, y las guarda en
// data/noticias.json. No necesita librerías: solo Node 20.
import { readFile, writeFile } from "node:fs/promises";

const BUSQUEDAS = [
  '"obras por impuestos"',
  '"obras por impuestos" Antioquia',
  '"obras por impuestos" reconstrucción',
  '"obras por impuestos" "Bajo Cauca"',
  '"obras por impuestos" Caucasia',
  '"obras por impuestos" Nordeste antioqueño',
  '"obras por impuestos" Confis cupo',
  '"obras por impuestos" proyecto de ley',
  '"obras por impuestos" ART "Renovación del Territorio"',
  '"obras por impuestos" Cámara de Comercio Medellín',
  '"obras por impuestos" 2027'
];
const ES_OXI = /obras? por impuesto|\boxi\b|renovaci[oó]n del territorio/i;
const NO_CO = /per[uú]\b|proinversi|\bS\/\s?\d|\blima\b|\bsoles\b|ecuador|\bchile\b|paraguay\b|arequipa|cusco|piura|cajamarca|\bpuno\b|lambayeque|ayacucho|loreto|tacna|moquegua|[aá]ncash|hu[aá]nuco|apur[ií]mac|ucayali|tumbes|gobierno regional|\bGRA\b|oxi expr|servicios por impuestos/i;
const FUENTE_NO = /^(El Peruano|Gesti[oó]n|El Comercio Per[uú]|Primicias|Revista ProActivo|RPP|Andina|Diario Viral)$/i;
const UA = { "user-agent": "Mozilla/5.0 (compatible; MesaOxIBot/1.0; +https://github.com/haroldco45)" };

const limpiar = s => String(s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1] : ""; };

async function traer(url, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: c.signal, redirect: "follow" }); if (!r.ok) throw new Error(r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
async function google(q) {
  const xml = await traer(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=CO&ceid=CO:es-419`);
  return xml.split("<item>").slice(1).map(it => {
    let titulo = limpiar(tag(it, "title")); const fuente = limpiar(tag(it, "source"));
    if (fuente && titulo.endsWith(" - " + fuente)) titulo = titulo.slice(0, -(fuente.length + 3));
    return { titulo, url: limpiar(tag(it, "link")), fecha: new Date(limpiar(tag(it, "pubDate"))).toISOString(), fuente, resumen: "", imagen: null };
  });
}
async function bing(q) {
  const xml = await traer(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es-co&cc=co`);
  return xml.split("<item>").slice(1).map(it => {
    let url = limpiar(tag(it, "link"));
    try { const u = new URL(url); if (u.searchParams.get("url")) url = u.searchParams.get("url"); } catch {}
    const img = (it.match(/<News:Image>([\s\S]*?)<\/News:Image>/i) || [])[1];
    return { titulo: limpiar(tag(it, "title")), url, fecha: new Date(limpiar(tag(it, "pubDate"))).toISOString(), fuente: limpiar(tag(it, "News:Source")), resumen: limpiar(tag(it, "description")).slice(0, 280), imagen: img ? limpiar(img) : null };
  });
}
async function imagenDe(url) {
  if (!url || url.includes("news.google.com")) return null;
  try {
    const html = (await traer(url, 8000)).slice(0, 200000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
    return m ? new URL(m[1], url).href : null;
  } catch { return null; }
}
const clave = n => n.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").slice(0, 70);
const relevante = n => { const s = n.titulo + " " + n.resumen; return ES_OXI.test(s) && !NO_CO.test(s) && !FUENTE_NO.test(n.fuente || "") && !/\.pe(\/|$)/.test(n.url) && !/\.(ec|cl|ar|bo|py)\//.test(n.url); };

let previas = [];
try { previas = JSON.parse(await readFile("data/noticias.json", "utf8")).noticias || []; } catch {}
const todas = [...previas];
for (const q of BUSQUEDAS) for (const f of [google, bing]) {
  try { todas.push(...(await f(q))); } catch (e) { console.log("Falló", f.name, q, e.message); }
}
const vistos = new Map();
for (const n of todas) {
  if (!n.titulo || !n.url || isNaN(new Date(n.fecha)) || !relevante(n)) continue;
  const k = clave(n), ya = vistos.get(k);
  if (!ya) vistos.set(k, n);
  else { if (!ya.imagen && n.imagen) ya.imagen = n.imagen; if (ya.url.includes("news.google.com") && !n.url.includes("news.google.com")) ya.url = n.url; }
}
const lista = [...vistos.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 120);
let buscadas = 0;
for (const n of lista) if (!n.imagen && buscadas < 25) { n.imagen = await imagenDe(n.url); buscadas++; }
await writeFile("data/noticias.json", JSON.stringify({ actualizado: new Date().toISOString(), noticias: lista }, null, 1));
console.log(`Listo: ${lista.length} noticias (${lista.filter(n => n.imagen).length} con foto).`);
