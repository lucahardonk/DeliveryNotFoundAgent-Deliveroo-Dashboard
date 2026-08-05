// ─────────────────────────────────────────────────────────────────────────────
// Minimal, generic Behaviour Tree building blocks.
// Every node exposes tick(ctx) → Status.{SUCCESS,FAILURE,RUNNING}, so composite
// nodes (Selector/Sequence) can be nested arbitrarily and reused across agents.
// ─────────────────────────────────────────────────────────────────────────────

export const Status = Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILURE: 'FAILURE',
    RUNNING: 'RUNNING',
});

/** First child that doesn't FAIL wins. */
export class Selector {
    constructor(children) { this.children = children; }
    async tick(ctx) {
        for (const child of this.children) {
            const status = await child.tick(ctx);
            if (status !== Status.FAILURE) return status;
        }
        return Status.FAILURE;
    }
}

/** All children must SUCCEED in order; stops at the first non-SUCCESS. */
export class Sequence {
    constructor(children) { this.children = children; }
    async tick(ctx) {
        for (const child of this.children) {
            const status = await child.tick(ctx);
            if (status !== Status.SUCCESS) return status;
        }
        return Status.SUCCESS;
    }
}

/** Leaf: wraps a synchronous predicate ctx → boolean. */
export class Condition {
    constructor(predicate) { this.predicate = predicate; }
    async tick(ctx) {
        return this.predicate(ctx) ? Status.SUCCESS : Status.FAILURE;
    }
}

/** Leaf: wraps an (async) handler ctx → Status. */
export class Action {
    constructor(fn) { this.fn = fn; }
    async tick(ctx) {
        return this.fn(ctx);
    }
}
