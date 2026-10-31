import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import { BackgroundExperienceFileSchema, type BackgroundExperienceFile, type BackgroundPhase } from "../domain/contracts.js";

const SHARED_USER_ALIASES = new Set(["owner", "user", "利用者", "現在のユーザー", "主人", "あなた", "ユーザー"]);
const ROLE_MARKERS = ["if001", "作成者", "友人", "友達", "同僚", "上司", "部下", "先生", "生徒", "学生", "店主", "店員", "隣人", "パートナー", "恋人", "先輩", "後輩", "チームメイト", "監督", "コーチ", "医師", "看護師", "客", "通行人", "知人", "同級生", "クラスメート", "仲間", "一人", "自分", "複数のユーザー", "ユーザーA", "ユーザーB", "ユーザーC"];
const ROLE_SUFFIXES = ["さん", "君", "氏", "先生", "教授", "医師", "看護師", "店員", "店主", "上司", "部下", "同僚", "友人", "友達", "先輩", "後輩", "監督", "コーチ"];
const PHASE_ORDER: Readonly<Record<BackgroundPhase, number>> = { 最初期: 0, 初期: 1, 中期: 2, 最近: 3 };

const looksLikeIdentifiablePerson = (participant: string): boolean => {
  const value = participant.trim();
  if (ROLE_MARKERS.includes(value)) return false;
  const suffix = ROLE_SUFFIXES.find((candidate) => value.endsWith(candidate));
  const base = suffix === undefined ? value : value.slice(0, -suffix.length);
  if (suffix !== undefined && base !== "" && /^[\p{Script=Han}]{2,4}$/u.test(base)) return true;
  if (ROLE_MARKERS.some((marker) => value.includes(marker))) return false;
  return /^[\p{Script=Han}]{2,4}(さん|君|氏)?$/u.test(value) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/u.test(value);
};

const fail = (message: string): never => {
  throw new Error(`Invalid background experience file: ${message}`);
};

export function validateBackgroundExperienceFile(input: unknown): BackgroundExperienceFile {
  const file = BackgroundExperienceFileSchema.parse(input);
  const now = new Date();
  if (file.profile.experienceScope.length === 0) fail("profile experienceScope must not be empty");

  const ids = new Set<string>();
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousPhaseOrder = Number.NEGATIVE_INFINITY;
  for (const experience of file.experiences) {
    if (ids.has(experience.id)) fail(`duplicate experience id: ${experience.id}`);
    ids.add(experience.id);
    const occurredAt = Date.parse(experience.occurredAt);
    if (!Number.isFinite(occurredAt)) fail(`invalid occurredAt: ${experience.id}`);
    if (occurredAt > now.getTime() + 86_400_000) fail(`experience is in the future: ${experience.id}`);
    if (occurredAt < previousTime) fail(`experiences are not chronological: ${experience.id}`);
    const phaseOrder = PHASE_ORDER[experience.phase];
    if (phaseOrder < previousPhaseOrder) fail(`experience phase decreases over time: ${experience.id}`);
    previousTime = occurredAt;
    previousPhaseOrder = phaseOrder;
    if (experience.participants.some((participant) => SHARED_USER_ALIASES.has(participant.toLocaleLowerCase("ja")))) fail(`experience includes the current user: ${experience.id}`);
    if (experience.participants.some(looksLikeIdentifiablePerson)) fail(`experience includes an identifiable real person: ${experience.id}`);
    const text = [experience.place, experience.relationship, experience.action, experience.feeling, experience.outcome, experience.lesson].join("\n");
    if (text.includes("現在のユーザー")) fail(`experience includes the current user: ${experience.id}`);
  }

  if (file.experiences.length >= 10) {
    const tags = new Set(file.experiences.flatMap(({ tags: values }) => values));
    const importances = new Set(file.experiences.map(({ importance }) => importance));
    const feelings = new Set(file.experiences.map(({ feeling }) => feeling));
    const phases = new Set(file.experiences.map(({ phase }) => phase));
    if (tags.size < 5) fail("experience tags are not distributed");
    if (importances.size < 2) fail("experience importance is not distributed");
    if (feelings.size < 3) fail("experience feelings are not distributed");
    if (phases.size < 3) fail("experience phases are not distributed");
  }
  return file;
}

export async function loadBackgroundExperienceFile(path: string): Promise<BackgroundExperienceFile> {
  return validateBackgroundExperienceFile(parse(await readFile(path, "utf8")));
}
