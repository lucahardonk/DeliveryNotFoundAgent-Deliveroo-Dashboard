/**
 * Parcel value / reward-decay helpers.
 *
 * Parcels lose reward over time: the value decreases by 1 every
 * `decayInterval` milliseconds. Each move step takes `clock` milliseconds, so
 * `steps` moves correspond to `steps * clock` milliseconds of decay.
 *
 * These functions are pure — they take the raw parcel list plus timing config
 * and return numbers — so they can be unit-tested in isolation and reused by
 * any agent strategy.
 *
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOParcel.js").IOParcel} IOParcel
 */

/**
 * Timing configuration extracted from the game options.
 * @typedef {Object} DecayConfig
 * @property {number} clock         - milliseconds per move step
 * @property {number} decayInterval - milliseconds between each -1 reward decay
 */

/**
 * Projected total reward of all parcels carried by `agentId` after `steps`
 * moves, accounting for value decay.
 *
 * @param {IOParcel[]} parcels
 * @param {string} agentId
 * @param {number} [steps=0]
 * @param {DecayConfig} config
 * @returns {number}
 */
export function carriedParcelsValueAfterSteps(parcels, agentId, steps = 0, { clock = 0, decayInterval = Infinity } = {}) {
    return parcels
        .filter(parcel => parcel.carriedBy === agentId)
        .reduce((total, parcel) => {
            const decay = decayInterval > 0 ? Math.floor((steps * clock) / decayInterval) : 0;
            return total + Math.max(0, parcel.reward - decay);
        }, 0);
}

/**
 * Projected total reward when detouring to pick up `candidateParcel` before
 * delivering. All parcels (carried and candidate) decay continuously
 * regardless of who holds them, so the full trip length
 * `stepsToParcel + stepsToDelivery` is used for every parcel.
 *
 * @param {IOParcel[]} parcels
 * @param {string} agentId
 * @param {number} stepsToParcel
 * @param {number} stepsToDelivery
 * @param {IOParcel} candidateParcel
 * @param {DecayConfig} config
 * @returns {number}
 */
export function carriedParcelsValueWithDeviation(parcels, agentId, stepsToParcel, stepsToDelivery, candidateParcel, { clock = 0, decayInterval = Infinity } = {}) {
    const totalSteps = stepsToParcel + stepsToDelivery;

    const carriedValue = carriedParcelsValueAfterSteps(parcels, agentId, totalSteps, { clock, decayInterval });

    const candidateDecay = decayInterval > 0 ? Math.floor((totalSteps * clock) / decayInterval) : 0;
    const candidateValue = Math.max(0, candidateParcel.reward - candidateDecay);

    return carriedValue + candidateValue;
}

/**
 * @param {IOParcel} parcel
 * @returns {boolean} true when the parcel is lying free on the ground.
 */
export function isFree(parcel) {
    return parcel.carriedBy == null;
}
