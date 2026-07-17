/**
 * Executes movement commands against the Deliveroo server with retry logic.
 *
 * A single move can fail transiently (e.g. another agent momentarily blocks the
 * target tile). `resilientMove` retries a few times before giving up and
 * shouting for help, so strategy code can treat a null return as "genuinely
 * blocked".
 *
 * @typedef {import("../domain/Position.js").MoveDirection} MoveDirection
 */
export class MovementExecutor {
    /** @param {import("../api/DeliverooClient.js").DeliverooClient} client */
    constructor(client) {
        this.client = client;
    }

    /**
     * Attempts to move `direction`, retrying up to `maxAttempts` times.
     * @param {MoveDirection} direction
     * @param {number} [maxAttempts=3]
     * @returns {Promise<object|null>} the server move result, or null if it failed after all attempts.
     */
    async resilientMove(direction, maxAttempts = 3) {
        for (let i = 0; i < maxAttempts; ++i) {
            console.log(`Moving ${direction} (attempt ${i + 1}/${maxAttempts})...`);
            const result = await this.client.move(direction);
            if (result) return result;

            console.log(`Move ${direction} failed (attempt ${i + 1}/${maxAttempts}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await this.client.shout(`Help! Blocked trying to move ${direction}`);
        console.error(`Move ${direction} failed after ${maxAttempts} attempts. Giving up.`);
        return null;
    }
}
