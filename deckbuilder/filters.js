/** Common EDH tutors whose names do not include "Tutor". */
const TUTOR_NAMES = new Set([
  "Imperial Seal",
  "Diabolic Intent",
  "Diabolic Revelation",
  "Demonic Consultation",
  "Gamble",
  "Crop Rotation",
  "Chord of Calling",
  "Green Sun's Zenith",
  "Natural Order",
  "Eladamri's Call",
  "Finale of Devastation",
  "Birthing Pod",
  "Prime Speaker Vannifar",
  "Wishclaw Talisman",
  "Scheming Symmetry",
  "Spellseeker",
  "Recruiter of the Guard",
  "Imperial Recruiter",
  "Ranger-Captain of Eos",
  "Summoner's Pact",
  "Intuition",
  "Bribery",
  "Acquire",
  "Fabricate",
  "Reshape",
  "Whir of Invention",
  "Treasure Mage",
  "Trophy Mage",
  "Trinket Mage",
  "Tribute Mage",
]);

/**
 * @param {string} name
 */
export function isTutorCard(name) {
  if (!name) return false;
  if (/tutor/i.test(name)) return true;
  return TUTOR_NAMES.has(name);
}
