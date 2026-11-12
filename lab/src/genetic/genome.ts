// The numbers of the spec (#88): criterion 1 is `notUsed`, criterion 13 is `tallGrass`.
const WALK_CRITERIA = ["notUsed", "distance", "isExit", "isPerson", "isSign", "isCell", "newMap", "previousMap", "mapVisits", "neverWalked", "unknownNeighbours", "mapEdge", "tallGrass"] as const;

export type WalkCriterion = (typeof WALK_CRITERIA)[number];

/** A criterion with no weight has the weight 0: a Genome of an older version of the Genetic bot has no weight for a new criterion. */
export type Weights<C extends string> = Partial<Record<C, number>>;

export type Genome = { walk: Weights<WalkCriterion> };

const GROUPS: Record<keyof Genome, readonly string[]> = { walk: WALK_CRITERIA };

/** Each value of `criteria` is from 0 to 1, and each weight from −1 to 1. */
export function scoreOf<C extends string>(weights: Weights<C>, criteria: Partial<Record<C, number>>): number {
  return Object.entries(criteria).reduce((sum, [criterion, value]) => sum + (weights[criterion as C] ?? 0) * (value as number), 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readGenome(json: unknown): Genome {
  if (!isObject(json)) throw new Error("a Genome is an object of groups of weights, for example {\"walk\": {\"isExit\": 1}}");
  const genome: Genome = { walk: {} };
  for (const [group, weights] of Object.entries(json)) {
    const criteria = GROUPS[group as keyof Genome];
    if (!criteria) throw new Error(`a Genome has no group "${group}": the groups are ${Object.keys(GROUPS).join(", ")}`);
    if (!isObject(weights)) throw new Error(`the group "${group}" of a Genome is an object of weights`);
    for (const [criterion, weight] of Object.entries(weights)) {
      if (!criteria.includes(criterion)) throw new Error(`the group "${group}" has no criterion "${criterion}": the criteria are ${criteria.join(", ")}`);
      if (typeof weight !== "number" || !(weight >= -1 && weight <= 1)) throw new Error(`the weight of "${group}.${criterion}" must be a number from -1 to 1, not ${JSON.stringify(weight)}`);
    }
    genome[group as keyof Genome] = weights as Weights<WalkCriterion>;
  }
  return genome;
}
