// What the page says of the wallet's answer to placeOrder and of a trade's state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placedText, STATE_WORDS } from '../shared/order-words.js'

test('a trade still being sent is under way, never traded', () => {
  assert.equal(placedText({ trade: 't', filled: 0, under_way: 1, state: 'sending', failed: [], order: null, order_error: null, gave: '0', got: '0' }),
    'Your trade is under way. Follow it under Your orders.')
  assert.equal(STATE_WORDS.sending, 'Sending')
})

test('the answers the page said before read the same', () => {
  assert.equal(placedText({ trade: 't', filled: 1, failed: [], order: null }), 'Traded with 1 order. Follow it under Your orders.')
  assert.equal(placedText({ trade: null, filled: 0, failed: [], order: 'o' }), 'Your order is on the book. Follow it under Your orders.')
  assert.equal(placedText({ filled: 2, order: 'o', failed: ['x'] }), 'Traded with 2 orders. Your order for the rest is on the book. 1 order was taken by someone else first; nothing of yours moved for it. Follow it under Your orders.')
})
