// The ticket's status line keeps what the page said of an order when the form is drawn again
// while the wallet is asked: the wallet's answer reaches the line on the page, never one the
// redraw took away (a site's BTC sale the wallet answered at once read nothing for 60 s).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { statusLine } from '../shared/status-line.js'

const line = () => ({ className: 'status', textContent: '' })

test('an answer given after the form was drawn again shows on the line on the page', () => {
  let onPage = line()
  const status = statusLine(() => onPage)
  status.say('status', 'Waiting for your approval in the wallet…')
  const before = onPage
  // The wallet's features are read again while it is asked: the form, and its line, drawn anew.
  onPage = line()
  status.paint()
  assert.equal(onPage.textContent, 'Waiting for your approval in the wallet…', 'the new line says what the old one said')
  status.say('status ok', 'Traded with 1 order. Follow it under Your orders.')
  assert.equal(onPage.className, 'status ok')
  assert.equal(onPage.textContent, 'Traded with 1 order. Follow it under Your orders.')
  assert.notEqual(before, onPage)
})

test('with no line on the page, nothing is written and nothing is lost', () => {
  let onPage = null
  const status = statusLine(() => onPage)
  status.say('status err', 'You declined in the wallet. Nothing was traded.')
  onPage = line()
  status.paint()
  assert.deepEqual([onPage.className, onPage.textContent], ['status err', 'You declined in the wallet. Nothing was traded.'])
})

test('the market page writes every word of an order through the status line, and draws it on each form', () => {
  const src = readFileSync(new URL('../js/market-page.js', import.meta.url), 'utf8')
  const submit = src.slice(src.indexOf('async function submit()'), src.indexOf('// ---- the phone'))
  // No status element is held across the wait for the wallet.
  assert.ok(!/\$\('fStatus'\)/.test(submit), 'submit never holds the status element itself')
  assert.ok(/status\.say\('status ok', placedText\(r\)\)/.test(submit), 'the answer goes through the status line')
  const render = src.slice(src.indexOf('function renderForm()'), src.indexOf('// The limit options'))
  assert.ok(/status\.paint\(\)/.test(render), 'a form drawn again shows what was last said')
  assert.ok(/go\.disabled = busy/.test(render), 'and keeps its button off while an order is under way')
})
