import type { DetectedPerson, SatelliteTelemetry } from '../types';

/**
 * Suppresses near-field acoustic diffraction duplicates when Laptop (Front) and
 * POCO M2 Pro (Backside) sit on the same desk/floor and both hear a single person
 * sitting close in front of the laptop (< 1.35m).
 *
 * - 1 person sitting in front near both devices -> 1 target (Front)
 * - 1 person stepping behind the laptop -> 1 target (Backside POCO)
 * - 1 person in front + 1 person >= 1.45m behind -> 2 targets (Front + Backside)
 */
export function getFilteredSatelliteTargets(
  frontTargets: DetectedPerson[],
  sat: SatelliteTelemetry | null | undefined,
  laptopArmed: boolean
): DetectedPerson[] {
  if (!sat || !sat.armed || Date.now() - sat.updatedAtMs >= 4000) {
    return [];
  }

  if (!laptopArmed || frontTargets.length === 0 || sat.zone !== 'BACK') {
    return sat.targets;
  }

  return sat.targets.filter((st) => {
    for (const ft of frontTargets) {
      const bothNearRig = ft.distanceMeters < 1.35 && st.distanceMeters < 1.45;
      if (!bothNearRig) continue;

      const similarWrapRange = Math.abs(st.distanceMeters - ft.distanceMeters) < 0.55;
      const frontIsDominant = st.snrDb <= ft.snrDb + 2.0;
      if (similarWrapRange && frontIsDominant) {
        return false;
      }

      if (ft.distanceMeters < 0.95 && st.distanceMeters < 1.20 && st.snrDb < ft.snrDb) {
        return false;
      }
    }
    return true;
  });
}
