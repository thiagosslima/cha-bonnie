// Gera páginas estáticas por cidade com metadados próprios (WhatsApp não executa JS).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
const site = (process.env.SITE_URL || process.env.URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '')
const html = readFileSync(join(dist, 'index.html'), 'utf8')

const pages = {
  '': { title: 'Chá de bebê da Bonnie', desc: 'Indaiatuba, 28/11 e Guarulhos, 05/12. Confirme sua presença 💜', image: 'home', color: '#F8F5FA' },
  indaiatuba: { title: 'Chá de bebê da Bonnie · Indaiatuba', desc: 'Sábado, 28 de novembro, às 15h. Confirme sua presença 💖', image: 'indaiatuba', color: '#FDF5F8' },
  guarulhos: { title: 'Chá de bebê da Bonnie · Guarulhos', desc: 'Sábado, 05 de dezembro, às 16h. Confirme sua presença 💜', image: 'guarulhos', color: '#F8F5FA' },
  admin: { title: 'Painel · Chá da Bonnie', desc: 'Área privada', image: 'home', color: '#F8F5FA', noindex: true },
}

const abs = (p) => (site ? site + p : p)
for (const [slug, m] of Object.entries(pages)) {
  let out = html
    .replace(/<title>.*?<\/title>/, `<title>${m.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${m.desc}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${m.title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${m.desc}`)
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${abs(`/og/${m.image}.png`)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${abs(`/${slug}`)}`)
    .replace(/(<meta name="theme-color" content=")[^"]*/, `$1${m.color}`)
  if (m.noindex) out = out.replace('</head>', '  <meta name="robots" content="noindex,nofollow" />\n  </head>')
  const dir = slug ? join(dist, slug) : dist
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), out)
}
if (!site) console.warn('[postbuild] SITE_URL não definido: og:image ficará relativo. Defina SITE_URL para prévias no WhatsApp.')
console.log('[postbuild] páginas geradas:', Object.keys(pages).map((s) => '/' + s).join(', '))
