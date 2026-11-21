import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTurn, isListeningSound } from '../dist/turns.mjs';

const speaking = { agentSpeaking: true, agentText: 'మీ BP tablet ఒకటి breakfast తర్వాత వేసుకోవాలి' };
const asked = { agentSpeaking: false };
const decide = (heard, context) => classifyTurn(heard, context).decision;

test('listening sounds while the agent talks keep it going', () => {
  for (const heard of ['సరే', 'సరే సరే', 'అవును', 'హ్మ్', 'ఆ', 'hmm', 'aa', 'sare sare', 'avunu', 'అవునండి', 'haan', 'ok', 'Hmm…']) {
    assert.equal(decide(heard, speaking), 'backchannel', heard);
  }
});

test('the same "avunu" after a question is an answer', () => {
  assert.equal(decide('అవును', asked), 'answer');
  assert.equal(decide('avunu', asked), 'answer');
});

test('stop words take the floor even though they are short', () => {
  for (const heard of ['ఆగండి', 'aagandi', 'చాలు', 'sare sare chaalu', 'సరే సరే, చాలు', 'wait', 'ఆపండి']) {
    assert.equal(decide(heard, speaking), 'yield', heard);
  }
});

test('a question or new information interrupts', () => {
  assert.equal(decide('Aagandi, ee tablet?', speaking), 'yield');
  assert.equal(decide('ఈ tablet?', speaking), 'yield');
  assert.equal(decide('అవును, కానీ tablet వేసుకోలేదు', speaking), 'yield');
  assert.equal(decide('aa aa kaani nenu adagaledu', speaking), 'yield');
  assert.equal(decide('కాదు కాదు', speaking), 'yield');
});

test('empty transcripts and agent echo are ignored', () => {
  assert.equal(decide('', speaking), 'noise');
  assert.equal(decide('...', speaking), 'noise');
  assert.equal(decide('మీ BP tablet ఒకటి breakfast తర్వాత', speaking), 'noise');
});

test('listening-sound detector rejects real words', () => {
  assert.equal(isListeningSound('సరే సరే'), true);
  assert.equal(isListeningSound('mmm'), true);
  assert.equal(isListeningSound('వేసుకున్నాను'), false);
  assert.equal(isListeningSound('sare kaani'), false);
});

test('captions drop stray scripts and repair doubled vowel signs', async () => {
  const { cleanText } = await import('../dist/realtime.mjs');
  assert.equal(cleanText('సరే, 30 నిమిషాల తర్వాత మళ్లీ కాల్ వస్తుంది.ありがとうございます!'), 'సరే, 30 నిమిషాల తర్వాత మళ్లీ కాల్ వస్తుంది.!');
  assert.equal(cleanText('Glycomet 500, ఒక tablet వేసుుకున్నారా?'), 'Glycomet 500, ఒక tablet వేసుకున్నారా?');
  assert.equal(cleanText('ఆగండి, ఈ tablet?'), 'ఆగండి, ఈ tablet?');
});
