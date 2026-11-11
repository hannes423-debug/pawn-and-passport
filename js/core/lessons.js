/**
 * lessons.js - the club practice tree: what is unlocked, and what is done.
 *
 * The tree is organised in TIERS (config.PRACTICE.tiers), each holding one or
 * more rating bands of lessons. The beginner tier (up to 600) is open from the
 * start; every Club Trophy - one per tournament completed - opens the next
 * tier, the last one at 1500, which is where this game's Elo ceiling is.
 *
 * Nothing is compulsory and nothing expires: inside the unlocked tiers a
 * player can start at any lesson, skip a whole band, and come back to an
 * earlier lesson at any time. Progress is per lesson and per challenge, so a
 * half-finished lesson is remembered.
 *
 * Save shape (career.lessons[lessonId]):
 *   { read: ts, watched: ts, solved: { [challengeId]: ts }, done: ts }
 */

import { PRACTICE, XP } from '../data/config.js';
import { LESSONS, lessonById } from '../data/lessons.js';
import { grantXp, trophyCount } from './career.js';

export const TIERS = PRACTICE.tiers;

/** The tier a band belongs to, or null for a band nothing teaches. */
export function tierForBand(band) {
  return TIERS.find((t) => t.bands.includes(band)) || null;
}

export const tierById = (id) => TIERS.find((t) => t.id === id) || null;

/** How many tiers are open: the beginner tier plus one per Club Trophy. */
export function unlockedTierCount(career) {
  const trophies = trophyCount(career || {});
  return TIERS.filter((t) => trophies >= t.trophies).length;
}

export const isTierUnlocked = (career, tier) => trophyCount(career || {}) >= tier.trophies;

/** The next tier to open, with what it is waiting for. */
export function nextTier(career) {
  const trophies = trophyCount(career || {});
  const tier = TIERS.find((t) => trophies < t.trophies);
  if (!tier) return null;
  return { tier, trophiesNeeded: tier.trophies - trophies };
}

export const isLessonUnlocked = (career, lesson) => {
  const tier = tierForBand(lesson.band);
  return !!tier && isTierUnlocked(career, tier);
};

/* ------------------------------------------------------------- progress -- */

const record = (career, lessonId) => {
  career.lessons = career.lessons || {};
  career.lessons[lessonId] = career.lessons[lessonId] || { solved: {} };
  const entry = career.lessons[lessonId];
  entry.solved = entry.solved || {};
  return entry;
};

/** Read-only view of one lesson's state. */
export function lessonProgress(career, lesson) {
  const entry = career?.lessons?.[lesson.id] || {};
  const solvedIds = Object.keys(entry.solved || {});
  const solved = lesson.challenges.filter((c) => (entry.solved || {})[c.id]).length;
  const total = lesson.challenges.length;
  return {
    read: !!entry.read,
    watched: !!entry.watched,
    solved,
    total,
    solvedIds,
    complete: !!entry.done,
    started: !!(entry.read || entry.watched || solved),
    /* "everything there is to do here": read, watched if there is a demo, and
       every challenge solved at least once */
    allDone: !!entry.read && (!lesson.demo.length || !!entry.watched) && solved >= total
  };
}

/** Marks the instructions as read. Returns true the first time. */
export function markRead(career, lessonId) {
  const entry = record(career, lessonId);
  if (entry.read) return false;
  entry.read = Date.now();
  return true;
}

/** Marks the animated demo as watched to the end. Returns true the first time. */
export function markWatched(career, lessonId) {
  const entry = record(career, lessonId);
  if (entry.watched) return false;
  entry.watched = Date.now();
  return true;
}

/**
 * Records a solved challenge and, when nothing is left undone, the lesson.
 * Pays XP only for firsts, so replaying a lesson is free of rewards but never
 * blocked. Returns { firstSolve, xp, lessonComplete, lessonXp }.
 */
export function recordChallengeSolved(career, lessonId, challengeId) {
  const lesson = lessonById(lessonId);
  if (!lesson) return { firstSolve: false, xp: null, lessonComplete: false, lessonXp: null };
  const entry = record(career, lessonId);
  const firstSolve = !entry.solved[challengeId];
  let xp = null;
  if (firstSolve) {
    entry.solved[challengeId] = Date.now();
    career.stats.lessonChallenges = (career.stats.lessonChallenges || 0) + 1;
    xp = grantXp(career, PRACTICE.xpChallenge);
  }
  let lessonComplete = false;
  let lessonXp = null;
  if (!entry.done && lessonProgress(career, lesson).allDone) {
    entry.done = Date.now();
    career.stats.lessonsDone = (career.stats.lessonsDone || 0) + 1;
    lessonXp = grantXp(career, PRACTICE.xpLesson);
    lessonComplete = true;
  }
  return { firstSolve, xp, lessonComplete, lessonXp };
}

/** Completes the lesson if reading or watching was the last thing missing. */
export function settleLesson(career, lessonId) {
  const lesson = lessonById(lessonId);
  if (!lesson) return { lessonComplete: false, lessonXp: null };
  const entry = record(career, lessonId);
  if (entry.done || !lessonProgress(career, lesson).allDone) return { lessonComplete: false, lessonXp: null };
  entry.done = Date.now();
  career.stats.lessonsDone = (career.stats.lessonsDone || 0) + 1;
  return { lessonComplete: true, lessonXp: grantXp(career, PRACTICE.xpLesson) };
}

/* ---------------------------------------------------------------- totals -- */

/** Tree-wide counts, for the practice room and the journal. */
export function practiceSummary(career) {
  const open = LESSONS.filter((l) => isLessonUnlocked(career, l));
  const done = open.filter((l) => lessonProgress(career, l).complete);
  const solved = open.reduce((n, l) => n + lessonProgress(career, l).solved, 0);
  const challenges = open.reduce((n, l) => n + l.challenges.length, 0);
  return {
    tiersOpen: unlockedTierCount(career),
    tiersTotal: TIERS.length,
    lessonsOpen: open.length,
    lessonsTotal: LESSONS.length,
    lessonsDone: done.length,
    challengesSolved: solved,
    challengesOpen: challenges,
    next: nextTier(career)
  };
}

/** The lessons of one band, with their progress attached. */
export function bandRows(career, band) {
  return LESSONS.filter((l) => l.band === band).map((l) => ({ lesson: l, progress: lessonProgress(career, l) }));
}

/** Where a returning player should land: their newest unfinished lesson, else
    the first lesson of the highest unlocked tier. */
export function suggestedLesson(career) {
  const open = LESSONS.filter((l) => isLessonUnlocked(career, l));
  const started = open.filter((l) => { const p = lessonProgress(career, l); return p.started && !p.complete; });
  if (started.length) return started.sort((a, b) => b.band - a.band)[0];
  const fresh = open.filter((l) => !lessonProgress(career, l).started);
  if (fresh.length) return fresh.sort((a, b) => a.band - b.band)[0];
  return open[0] || null;
}

export default {
  TIERS, tierForBand, tierById, unlockedTierCount, isTierUnlocked, nextTier, isLessonUnlocked,
  lessonProgress, markRead, markWatched, recordChallengeSolved, settleLesson,
  practiceSummary, bandRows, suggestedLesson, XP
};
