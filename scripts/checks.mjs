// Finds hand-maintained data that is due for an update and opens one GitHub
// issue per item (GitHub e-mails the repo owner). Never edits data itself.
//
// Run in Actions with GITHUB_TOKEN + GITHUB_REPOSITORY; locally it only prints.

import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../docs/data.json', import.meta.url), 'utf8'));
const now = new Date(Date.now() + 3 * 3600_000); // Turkey time
const Y = now.getUTCFullYear();
const M = now.getUTCMonth() + 1;
const today = now.toISOString().slice(0, 10);

const due = [];

// 1) Yearly law figures (January)
if (data.law.year < Y) {
  due.push({
    title: `${Y} mevzuatı: vergi dilimleri, asgari ücret, SGK, damga vergisi, kıdem tavanı`,
    body: [
      `data.json hâlâ ${data.law.year} mevzuatını kullanıyor; uygulama kullanıcıya "güncel değil" uyarısı gösteriyor.`,
      '',
      'Resmi kaynaktan doğrulayıp `law` alanını güncelle:',
      `- [ ] Gelir vergisi tarifesi, ücret gelirleri (${Y} GVGT, Resmî Gazete)`,
      `- [ ] Brüt asgari ücret (Asgari Ücret Tespit Komisyonu kararı)`,
      '- [ ] SGK işçi payı, işsizlik payı, prime esas kazanç tavanı (kaç katı)',
      '- [ ] Damga vergisi oranı',
      `- [ ] Kıdem tazminatı tavanı, 1 Ocak ${Y} (Hazine ve Maliye Bakanlığı genelgesi)`,
      `- [ ] \`law.year\` = ${Y}, \`law.checked\` = bugün, \`version\` = şimdiki tarih-saat`,
    ].join('\n'),
  });
}

// 2) July severance ceiling
const julyKey = `${Y}-07-01`;
if (today >= julyKey && data.law.year === Y && !data.law.severanceCeilings.some((c) => c.from >= julyKey)) {
  due.push({
    title: `Kıdem tazminatı tavanı: 1 Temmuz ${Y}`,
    body: `Temmuz memur maaş katsayısıyla kıdem tavanı değişir. Hazine ve Maliye Bakanlığı genelgesinden doğrulayıp \`law.severanceCeilings\` listesine \`{ "from": "${julyKey}", "amount": … }\` ekle.`,
  });
}

// 3) Mid-year minimum wage raise (only a reminder to check)
if (M === 7 && data.law.year === Y) {
  due.push({
    title: `Temmuz ${Y}: asgari ücrete ara zam yapıldı mı?`,
    body: 'Yapıldıysa brüt asgari ücret 1 Temmuz itibarıyla değişir; uygulamada yıl ortası değişim henüz desteklenmiyor, birlikte ele alalım. Yapılmadıysa bu konuyu kapat.',
  });
}

// 4) Holiday coverage: next two years should be complete
for (const y of [Y, Y + 1]) {
  const c = data.coverage[String(y)];
  if (c !== 'complete') {
    due.push({
      title: `${y} resmî tatil ve bayram tarihleri`,
      body: `coverage[${y}] = ${c ?? 'yok'}. Ramazan ve Kurban Bayramı ile arifelerini Diyanet takviminden, sabit tatilleri 2429 sayılı kanundan doğrulayıp \`holidays\` listesine ekle; sonra \`coverage.${y}\` = "complete".`,
    });
  }
}

// 5) MEB calendar for the coming school year (from June)
if (M >= 6) {
  const hasNext = data.schoolBreaks.some((b) => (b.start ?? '') >= `${Y}-09-01`);
  if (!hasNext) {
    due.push({
      title: `MEB ${Y}–${Y + 1} çalışma takvimi (ara tatiller, yarıyıl)`,
      body: 'MEB çalışma takvimi yayımlandığında ara tatil ve yarıyıl tarihlerini `schoolBreaks` listesine ekle.',
    });
  }
}

// 6) Expenditure-group inflation (personal inflation) older than 4 months
const g = data.inflation.groups?.month;
if (g) {
  const age = (Y - Number(g.slice(0, 4))) * 12 + (M - Number(g.slice(5, 7)));
  if (age > 4) {
    due.push({
      title: 'Kişisel enflasyon: harcama grubu verisi eski',
      body: `\`inflation.groups\` ${g} verisi. TÜİK bülteninden 12 ana harcama grubunun yıllık değişimini doğrulayıp güncelle.`,
    });
  }
}

// --- report / open issues -------------------------------------------------
const label = 'elle-guncelleme';
const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
if (!token || !repo) {
  console.log(due.length ? due.map((d) => `• ${d.title}`).join('\n') : 'Bekleyen elle güncelleme yok');
  process.exit(0);
}

const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${path}`))));

const open = await api(`/issues?state=open&labels=${label}&per_page=100`);
for (const d of due) {
  if (open.some((i) => i.title === d.title)) continue;
  await api('/issues', { method: 'POST', body: JSON.stringify({ title: d.title, body: d.body, labels: [label] }) });
  console.log('açıldı:', d.title);
}
