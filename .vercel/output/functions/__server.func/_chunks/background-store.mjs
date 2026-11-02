import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { __exportAll } from "../_runtime.mjs";
import { esm_default } from "../_libs/pg+[...].mjs";
import { require_functions } from "../_libs/vercel__functions.mjs";
import crypto from "node:crypto";
// server/build-requirements.js
/** Accepted acceptance requirements for one project, carried across change requests.
* A replanned project must keep each one or retire it with a stated reason; nothing is dropped silently. */
const REQUIREMENT_LIMITS = Object.freeze({
	active: 40,
	retired: 20,
	chars: 1e3,
	reason: 500
});
const invalid$1 = () => Object.assign(/* @__PURE__ */ new Error("The saved project requirements are invalid. Your files are kept; review the project brief before continuing."), {
	status: 400,
	code: "BUILD_REQUIREMENTS"
});
const text = (value, limit) => typeof value === "string" && value.trim() && value.length <= limit && !value.includes("\0");
/** Comparison ignores case, spacing and trailing punctuation so a copied requirement still matches. */
const requirementKey = (value) => String(value).trim().replace(/\s+/g, " ").replace(/[.!;:,\s]+$/, "").toLowerCase();
function normalizeRequirementLedger(value) {
	if (value == null) return null;
	if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => ![
		"version",
		"active",
		"retired"
	].includes(key)) || value.version !== 1 || !Array.isArray(value.active) || value.active.length > REQUIREMENT_LIMITS.active || !Array.isArray(value.retired) || value.retired.length > REQUIREMENT_LIMITS.retired) throw invalid$1();
	const seen = /* @__PURE__ */ new Set();
	return {
		version: 1,
		active: value.active.map((item) => {
			if (!text(item, REQUIREMENT_LIMITS.chars) || seen.has(requirementKey(item))) throw invalid$1();
			seen.add(requirementKey(item));
			return item.trim();
		}),
		retired: value.retired.map((item) => {
			if (!item || typeof item !== "object" || Object.keys(item).some((key) => ![
				"requirement",
				"reason",
				"at"
			].includes(key)) || !text(item.requirement, REQUIREMENT_LIMITS.chars) || !text(item.reason, REQUIREMENT_LIMITS.reason) || !Number.isSafeInteger(item.at) || item.at < 0) throw invalid$1();
			return {
				requirement: item.requirement.trim(),
				reason: item.reason.trim(),
				at: item.at
			};
		})
	};
}
/** Projects saved before the ledger existed start from their last accepted plan. */
function requirementLedgerFor(state) {
	if (state?.requirementLedger) return normalizeRequirementLedger(state.requirementLedger);
	const prior = [state?.checkpoint?.plan?.requirements, state?.previousCheckpoint?.plan?.requirements].find((list) => Array.isArray(list) && list.length);
	if (!prior) return null;
	const seen = /* @__PURE__ */ new Set(), active = [];
	for (const item of prior) if (text(item, REQUIREMENT_LIMITS.chars) && !seen.has(requirementKey(item)) && active.length < REQUIREMENT_LIMITS.active) {
		seen.add(requirementKey(item));
		active.push(item.trim());
	}
	return active.length ? {
		version: 1,
		active,
		retired: []
	} : null;
}
function requirementPrompt(ledger) {
	if (!ledger?.active.length) return "";
	return `Accepted requirements from earlier requests for this project (${ledger.active.length}). Copy each one verbatim into "requirements" unless a later change in the request replaces it. For each one you leave out, add {"requirement":"its exact text","reason":"the change that replaced it"} to a top-level "retired" array. Never drop one silently.\n${ledger.active.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}
/** Earlier requirements the plan neither kept nor retired. */
function missingRequirements(ledger, plan) {
	if (!ledger?.active.length) return [];
	const kept = new Set([...plan.requirements || [], ...(plan.retired || []).map((item) => item.requirement)].map(requirementKey));
	return ledger.active.filter((item) => !kept.has(requirementKey(item)));
}
/** Last resort after the repair attempt: keep what the planner forgot instead of losing it. */
function carryMissingRequirements(ledger, plan) {
	const missing = missingRequirements(ledger, plan);
	if (!missing.length) return plan;
	if (plan.requirements.length + missing.length > REQUIREMENT_LIMITS.active) throw new TypeError(`The new plan left out ${missing.length} earlier requirement(s) and has no room to keep them.`);
	return {
		...plan,
		requirements: [...plan.requirements, ...missing]
	};
}
/** After an accepted plan, its requirements become the active list; retired ones keep their reasons. */
function nextRequirementLedger(ledger, plan, at = Date.now()) {
	const earlier = new Set((ledger?.active || []).map(requirementKey)), active = new Map(plan.requirements.map((item) => [requirementKey(item), item]));
	const retired = (plan.retired || []).filter((item) => earlier.has(requirementKey(item.requirement)) && !active.has(requirementKey(item.requirement))).map((item) => ({
		requirement: item.requirement,
		reason: item.reason,
		at
	}));
	return normalizeRequirementLedger({
		version: 1,
		active: [...active.values()],
		retired: [...ledger?.retired || [], ...retired].slice(-REQUIREMENT_LIMITS.retired)
	});
}
// server/postgres-transaction.js
async function postgresTransaction(pool, action, { lock = "3s", statement = "10s", commitOnError = () => false } = {}) {
	let client, began = false, committing = false, finished = false, destroy = false;
	try {
		client = await pool.connect();
		await client.query("BEGIN");
		began = true;
		if (!/^\d+s$/.test(lock) || !/^\d+s$/.test(statement)) throw new TypeError("Invalid transaction timeout.");
		await client.query(`SET LOCAL lock_timeout = '${lock}'`);
		await client.query(`SET LOCAL statement_timeout = '${statement}'`);
		await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
		let result;
		try {
			result = await action(client);
		} catch (error) {
			if (commitOnError(error)) {
				committing = true;
				await client.query("COMMIT");
				committing = false;
				finished = true;
			}
			throw error;
		}
		committing = true;
		await client.query("COMMIT");
		committing = false;
		finished = true;
		return result;
	} catch (error) {
		destroy = committing || !began;
		if (client && !finished) try {
			await client.query("ROLLBACK");
		} catch {
			destroy = true;
		}
		throw error;
	} finally {
		client?.release(destroy);
	}
}
// server/postgres-options.js
function postgresPoolOptions(connectionString, options = {}) {
	const invalid = () => Object.assign(/* @__PURE__ */ new Error("Invalid or insecure PostgreSQL TLS configuration."), { code: "POSTGRES_TLS_CONFIG" });
	if (typeof connectionString !== "string" || Object.hasOwn(options, "ssl")) throw invalid();
	let url;
	try {
		url = new URL(connectionString);
	} catch {
		throw invalid();
	}
	if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.hostname.includes("%")) throw invalid();
	const effectiveHost = url.searchParams.get("host") || url.hostname;
	const local = [
		"localhost",
		"127.0.0.1",
		"[::1]",
		"::1"
	].includes(effectiveHost);
	for (const name of [
		"host",
		"sslmode",
		"ssl",
		"uselibpqcompat",
		"sslrootcert",
		"sslcert",
		"sslkey",
		"sslnegotiation"
	]) if (url.searchParams.getAll(name).length > 1) throw invalid();
	const mode = url.searchParams.get("sslmode");
	const ssl = url.searchParams.get("ssl"), compat = url.searchParams.get("uselibpqcompat"), negotiation = url.searchParams.get("sslnegotiation");
	if (url.searchParams.has("sslmode") && ![
		"prefer",
		"require",
		"verify-ca",
		"verify-full",
		"disable"
	].includes(mode)) throw invalid();
	if (url.searchParams.has("ssl") && ![
		"0",
		"1",
		"true",
		"false"
	].includes(ssl)) throw invalid();
	if (compat !== null && !["true", "false"].includes(compat) || negotiation !== null && !["direct", "postgres"].includes(negotiation)) throw invalid();
	const plaintext = mode === "disable" || ["0", "false"].includes(ssl);
	if (!local && plaintext || mode && mode !== "disable" && ["0", "false"].includes(ssl) || mode === "disable" && ["1", "true"].includes(ssl) || plaintext && (negotiation === "direct" || [
		"sslcert",
		"sslkey",
		"sslrootcert"
	].some((k) => url.searchParams.has(k))) || url.searchParams.has("sslca")) throw invalid();
	if ([
		"prefer",
		"require",
		"verify-ca"
	].includes(mode) || !local && !mode) url.searchParams.set("sslmode", "verify-full");
	return {
		...options,
		connectionString: url.toString()
	};
}
// server/governance-postgres.js
var import_functions = require_functions();
const unavailable = () => Object.assign(/* @__PURE__ */ new Error("Grandpa AI Build storage is temporarily unavailable. Your request is saved; please try again later."), {
	code: "GOVERNANCE_UNAVAILABLE",
	status: 503
});
function governanceScope(env = process.env) {
	if (env.RITUAL_GOVERNANCE_SCOPE) return env.RITUAL_GOVERNANCE_SCOPE;
	if (env.VERCEL_ENV === "preview") return `preview:${env.VERCEL_GIT_COMMIT_REF || env.VERCEL_URL || "unassigned"}`;
	return env.VERCEL_ENV === "production" ? "production" : "development";
}
function createPostgresGovernanceStorage({ connectionString, scope = governanceScope(), pool: suppliedPool } = {}) {
	if (typeof scope !== "string" || !scope || scope.length > 240) throw unavailable();
	const pool = suppliedPool || new esm_default.Pool(postgresPoolOptions(connectionString, {
		max: 4,
		connectionTimeoutMillis: 8e3,
		idleTimeoutMillis: 1e4,
		allowExitOnIdle: true
	}));
	if (!suppliedPool && process.env.VERCEL) (0, import_functions.attachDatabasePool)(pool);
	pool.on?.("error", () => console.error("[build-storage] Database connection unavailable."));
	let initialized;
	async function initialize() {
		if (!initialized) initialized = postgresTransaction(pool, async (client) => {
			await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_governance_schema_v1'))");
			await client.query("\nCREATE TABLE IF NOT EXISTS public.grandpa_ai_governance_state (\n  scope text PRIMARY KEY,\n  ledger jsonb NOT NULL,\n  audit_bytes bigint NOT NULL DEFAULT 0 CHECK (audit_bytes >= 0),\n  updated_at timestamptz NOT NULL DEFAULT now()\n);\nCREATE TABLE IF NOT EXISTS public.grandpa_ai_governance_audit (\n  scope text NOT NULL REFERENCES public.grandpa_ai_governance_state(scope),\n  sequence bigint NOT NULL CHECK (sequence > 0),\n  record text NOT NULL,\n  PRIMARY KEY (scope, sequence)\n);");
		}, { lock: "8s" }).catch((error) => {
			initialized = void 0;
			throw error;
		});
		return initialized;
	}
	return {
		scope,
		async transaction(action) {
			let dirty = false;
			try {
				await initialize();
				return await postgresTransaction(pool, async (client) => {
					let loaded;
					return action({
						async load(initial) {
							if (loaded) return loaded;
							await client.query("INSERT INTO public.grandpa_ai_governance_state (scope, ledger) VALUES ($1, $2::jsonb) ON CONFLICT (scope) DO NOTHING", [scope, JSON.stringify(initial)]);
							const result = await client.query("SELECT ledger, audit_bytes FROM public.grandpa_ai_governance_state WHERE scope = $1 FOR UPDATE", [scope]);
							if (result.rows.length !== 1) throw unavailable();
							const tail = await client.query("SELECT record FROM public.grandpa_ai_governance_audit WHERE scope = $1 ORDER BY sequence DESC LIMIT 1", [scope]);
							loaded = {
								state: result.rows[0].ledger,
								bytes: Number(result.rows[0].audit_bytes),
								head: tail.rows[0] ? JSON.parse(tail.rows[0].record) : null
							};
							return loaded;
						},
						async append(state, record) {
							if (!loaded) throw unavailable();
							const serialized = JSON.stringify(record);
							const bytes = Buffer.byteLength(serialized) + 1;
							if (loaded.bytes + bytes > 5e7) throw unavailable();
							await client.query("INSERT INTO public.grandpa_ai_governance_audit (scope, sequence, record) VALUES ($1, $2, $3)", [
								scope,
								record.sequence,
								serialized
							]);
							await client.query("UPDATE public.grandpa_ai_governance_state SET ledger = $2::jsonb, audit_bytes = audit_bytes + $3, updated_at = now() WHERE scope = $1", [
								scope,
								JSON.stringify(state),
								bytes
							]);
							loaded = {
								state,
								bytes: loaded.bytes + bytes,
								head: record
							};
							dirty = true;
						},
						async records() {
							return (await client.query("SELECT record FROM public.grandpa_ai_governance_audit WHERE scope = $1 ORDER BY sequence", [scope])).rows.map((row) => JSON.parse(row.record));
						}
					});
				}, {
					statement: "8s",
					commitOnError: (error) => dirty && error.persistAudit === true
				});
			} catch (error) {
				if (error.code?.startsWith("GOVERNANCE_") || error.code === "INVALID_LIMIT") throw error;
				throw unavailable();
			}
		},
		close: () => pool.end()
	};
}
// public/build-requests.js
/** Project request history is descriptive data, never approval or a scheduler. */
const BUILD_REQUEST_LIMITS = Object.freeze({
	entries: 20,
	briefChars: 6e3
});
const invalid = () => Object.assign(/* @__PURE__ */ new Error("The saved request history is invalid. Your files are kept; review the project brief before continuing."), {
	status: 400,
	code: "BUILD_REQUEST_HISTORY"
});
const full = () => Object.assign(/* @__PURE__ */ new Error("This project has reached its request-history limit. Your files are kept. Download the project and start a new build with a shorter brief."), {
	status: 400,
	code: "BUILD_REQUEST_LIMIT"
});
const render = (history) => history.entries.map((entry, index) => index ? `\n\nChange ${index} (overrides conflicts): ${entry.text}` : entry.text).join("");
function normalizeBuildRequests(value) {
	if (value == null) return null;
	if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => ![
		"version",
		"origin",
		"entries"
	].includes(key)) || value.version !== 1 || !["user", "legacy"].includes(value.origin) || !Array.isArray(value.entries) || !value.entries.length) throw invalid();
	if (value.entries.length > BUILD_REQUEST_LIMITS.entries) throw full();
	const entries = value.entries.map((entry, index) => {
		if (!entry || typeof entry !== "object" || Object.keys(entry).some((key) => ![
			"sequence",
			"kind",
			"text",
			"at"
		].includes(key)) || entry.sequence !== index + 1 || entry.kind !== (index ? "change" : "brief") || typeof entry.text !== "string" || !entry.text.trim() || entry.text.includes("\0") || !Number.isSafeInteger(entry.at) || entry.at < 0 || entry.at > 864e13) throw invalid();
		if (entry.text.length > BUILD_REQUEST_LIMITS.briefChars) throw full();
		return {
			sequence: index + 1,
			kind: entry.kind,
			text: entry.text.trim(),
			at: entry.at
		};
	});
	const history = {
		version: 1,
		origin: value.origin,
		entries
	};
	if (render(history).length > BUILD_REQUEST_LIMITS.briefChars) throw full();
	return history;
}
function buildRequestBrief(value) {
	const history = normalizeBuildRequests(value);
	return history ? render(history) : "";
}
// public/build-task-state.js
/** Shared, descriptive task state. This module cannot schedule or resume work. */
const pathIsSafe = (path) => typeof path === "string" && path.length <= 180 && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(path) && !path.split("/").some((part) => !part || part === "." || part === "..");
const phases = /* @__PURE__ */ new Set([
	"plan",
	"architecture",
	"build",
	"review",
	"gate"
]);
function buildBlocker(error = {}, checkpoint = {}, at = Date.now()) {
	const code = String(error.code || "");
	let kind = "failure";
	if (code === "BUILD_OUTCOME_UNCERTAIN") kind = "uncertain";
	else if (code === "GOVERNANCE_BUDGET" || /spending cap|credits? exhausted|quota/i.test(error.message || "")) kind = "budget";
	else if (code === "GOVERNANCE_RATE") kind = "rate";
	else if (code === "GOVERNANCE_CONCURRENCY") kind = "concurrency";
	else if (code === "GOVERNANCE_PAUSED") kind = "operator";
	else if (code === "GOVERNANCE_UNAVAILABLE") kind = "storage";
	else if (code === "BUILD_CONTEXT_LIMIT") kind = "context";
	else if (code === "BUILD_REVIEW_REQUIRED") kind = "review";
	else if (code === "BUILD_VERIFICATION_REQUIRED") kind = "verification";
	else if (code === "BUILD_INTERRUPTED") kind = "interrupted";
	else if ([401, 403].includes(error.status)) kind = "permission";
	return {
		kind,
		phase: phases.has(checkpoint.phase) ? checkpoint.phase : "plan",
		file: pathIsSafe(checkpoint.currentFile) ? checkpoint.currentFile : "",
		requiresResume: true,
		automaticRetry: false,
		at: Number.isFinite(at) ? at : Date.now()
	};
}
// server/build-jobs.js
const fail = (message, status = 503) => Object.assign(new Error(message), { status });
const canonical = (x) => x === null || typeof x !== "object" ? JSON.stringify(x) : Array.isArray(x) ? "[" + x.map(canonical).join(",") + "]" : "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
function validateOperation(op) {
	if (op === void 0) return;
	const allowed = [
		"version",
		"id",
		"generation",
		"kind",
		"path",
		"binding",
		"status",
		"result",
		"resultHash"
	];
	if (!op || typeof op !== "object" || Array.isArray(op) || Object.keys(op).some((k) => !allowed.includes(k)) || op.version !== 1 || !/^[a-f0-9-]{36}$/.test(op.id || "") || !Number.isSafeInteger(op.generation) || op.generation < 1 || ![
		"plan",
		"architecture",
		"generate",
		"review",
		"release"
	].includes(op.kind) || typeof op.path !== "string" || !/^[a-f0-9]{64}$/.test(op.binding || "") || ![
		"started",
		"returned",
		"denied",
		"uncertain",
		"retry_authorized",
		"applied"
	].includes(op.status)) throw fail("The saved AI operation receipt is invalid. Work is paused for recovery.");
	if (op.status === "returned") {
		if (op.result === void 0 || Buffer.byteLength(JSON.stringify(op.result)) > 6e5 || op.resultHash !== hash(canonical(op.result))) throw fail("The saved AI response receipt is invalid. Work is paused for recovery.");
	} else if (Object.hasOwn(op, "result") || Object.hasOwn(op, "resultHash")) throw fail("The saved AI operation receipt is inconsistent. Work is paused for recovery.");
}
const activeBuildStatus = (status) => [
	"queued",
	"planning",
	"architecting",
	"building",
	"reviewing",
	"repairing",
	"security"
].includes(status);
/** A progress poll may skip the full snapshot only for an exact revision match on a task that is not stale. */
function unchangedBuildJob(brief, known, now = Date.now()) {
	if (!Number.isSafeInteger(known) || known < 0 || brief.revision !== known || activeBuildStatus(brief.status) && now - brief.updatedAt > 9e4) return null;
	return {
		...brief,
		unchanged: true
	};
}
function validateBuildIdentity(id, token) {
	if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id || "") || !/^[a-f0-9]{64}$/i.test(token || "")) throw fail("This build could not be verified. Open it from your saved projects.", 403);
}
function requireBuildGeneration(action, generation) {
	if (["resume", "revise"].includes(action) && (!Number.isSafeInteger(generation) || generation < 1)) throw fail("Refresh this page before resuming or changing a saved task. Its current generation is required.", 409);
}
const SCHEMA = `CREATE TABLE IF NOT EXISTS public.grandpa_ai_build_jobs (
 id uuid PRIMARY KEY, scope text NOT NULL, token_hash text NOT NULL,
 generation integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 0,
 state jsonb NOT NULL, work_key text, work_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);`;
function createBuildJobStore({ connectionString, pool: suppliedPool, scope = governanceScope() } = {}) {
	const pool = suppliedPool || new esm_default.Pool(postgresPoolOptions(connectionString, {
		max: 3,
		connectionTimeoutMillis: 8e3,
		idleTimeoutMillis: 1e4,
		allowExitOnIdle: true
	}));
	if (!suppliedPool && process.env.VERCEL) (0, import_functions.attachDatabasePool)(pool);
	pool.on?.("error", () => console.error("[build-jobs] Database connection unavailable."));
	let ready;
	async function initialize() {
		if (!ready) ready = postgresTransaction(pool, async (client) => {
			await client.query("SELECT pg_advisory_xact_lock(hashtext('grandpa_ai_build_jobs_v1'))");
			await client.query(SCHEMA);
		}, { lock: "8s" }).catch((error) => {
			ready = void 0;
			throw error;
		});
		await ready;
	}
	async function transaction(action) {
		try {
			await initialize();
			return await postgresTransaction(pool, action, { lock: "5s" });
		} catch (error) {
			if (error.status) throw error;
			throw fail("Grandpa AI could not confirm this background transaction. Reconnect to check the saved task before retrying.");
		}
	}
	const snapshot = (row) => {
		validateOperation(row.state.operation);
		const { operation, ...state } = row.state;
		return {
			...state,
			...operation ? { operation: {
				id: operation.id,
				kind: operation.kind,
				path: operation.path,
				status: operation.status
			} } : {},
			id: row.id,
			generation: row.generation,
			revision: row.revision,
			updatedAt: new Date(row.updated_at).getTime(),
			processing: Boolean(row.work_key)
		};
	};
	async function rowFor(client, id, { token, lock = false } = {}) {
		const row = (await client.query(`SELECT * FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2${lock ? " FOR UPDATE" : ""}`, [id, scope])).rows[0];
		if (!row || token && row.token_hash !== hash(token)) throw fail("This background build is unavailable. Your saved device files are kept.", 404);
		validateOperation(row.state.operation);
		return row;
	}
	async function write(client, row, state, { generation = row.generation, key = null } = {}) {
		const { id: _id, generation: _generation, revision: _revision, updatedAt: _updated, processing: _processing, operation: _operation, ...data } = state;
		state = {
			...data,
			...row.state.operation ? { operation: row.state.operation } : {}
		};
		if (Buffer.byteLength(JSON.stringify(state)) > 18e5) throw fail("The cloud checkpoint is full. Download your files and continue with a smaller project.", 413);
		const result = await client.query("UPDATE public.grandpa_ai_build_jobs SET state=$3::jsonb,generation=$4,revision=revision+1,work_key=$5,work_started_at=CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,updated_at=now() WHERE id=$1 AND scope=$2 RETURNING *", [
			row.id,
			scope,
			JSON.stringify(state),
			generation,
			key
		]);
		return snapshot(result.rows[0]);
	}
	return {
		async create({ id, token, asked, files = [], checkpoint = null, requestHistory = null }) {
			validateBuildIdentity(id, token);
			const history = normalizeBuildRequests(requestHistory);
			if (history && buildRequestBrief(history) !== asked.trim()) throw fail("The request history does not match this task brief. Your saved files are kept.", 400);
			return transaction(async (client) => {
				await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`build-admission:${scope}`]);
				if ((await client.query("SELECT * FROM public.grandpa_ai_build_jobs WHERE id=$1", [id])).rows[0]) {
					const row = await rowFor(client, id, { token });
					return {
						job: snapshot(row),
						created: false
					};
				}
				if ((await client.query("SELECT count(*)::integer AS count FROM public.grandpa_ai_build_jobs WHERE scope=$1 AND created_at > now() - interval '1 day'", [scope])).rows[0].count >= 200) throw fail("Grandpa AI has reached today’s background task limit. Please return tomorrow.", 429);
				const state = {
					asked,
					files,
					checkpoint,
					...history ? { requestHistory: history } : {},
					status: "queued",
					events: [{
						at: Date.now(),
						message: "Build queued. You can leave this page."
					}],
					workflowId: null
				};
				const result = await client.query("INSERT INTO public.grandpa_ai_build_jobs (id,scope,token_hash,state) VALUES ($1,$2,$3,$4::jsonb) RETURNING *", [
					id,
					scope,
					hash(token),
					JSON.stringify(state)
				]);
				return {
					job: snapshot(result.rows[0]),
					created: true
				};
			});
		},
		get: (id, token) => {
			validateBuildIdentity(id, token);
			return transaction(async (client) => snapshot(await rowFor(client, id, { token })));
		},
		peek: (id, token) => {
			validateBuildIdentity(id, token);
			return transaction(async (client) => {
				const row = (await client.query("SELECT id,token_hash,generation,revision,updated_at,work_key,state->>'status' AS status FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2", [id, scope])).rows[0];
				if (!row || row.token_hash !== hash(token)) throw fail("This background build is unavailable. Your saved device files are kept.", 404);
				return {
					id: row.id,
					generation: row.generation,
					revision: row.revision,
					status: row.status,
					updatedAt: new Date(row.updated_at).getTime(),
					processing: Boolean(row.work_key)
				};
			});
		},
		internal: (id) => transaction(async (client) => snapshot(await rowFor(client, id))),
		async attach(id, generation, workflowId) {
			return transaction(async (client) => {
				const row = await rowFor(client, id, { lock: true });
				if (row.generation !== generation) return snapshot(row);
				return write(client, row, {
					...row.state,
					workflowId
				}, { key: row.work_key });
			});
		},
		async claim(id, generation) {
			return transaction(async (client) => {
				const row = await rowFor(client, id, { lock: true });
				if (row.generation !== generation || !activeBuildStatus(row.state.status)) return {
					job: snapshot(row),
					key: null
				};
				if (row.work_key && Date.now() - new Date(row.work_started_at).getTime() < 3e5) return {
					job: snapshot(row),
					key: null
				};
				if (row.work_key) {
					if (row.state.operation?.status === "started") row.state.operation.status = "uncertain";
					return {
						job: await write(client, row, {
							...row.state,
							status: "needs_attention",
							checkpoint: row.state.checkpoint ? {
								...row.state.checkpoint,
								blocker: buildBlocker({ code: "BUILD_INTERRUPTED" }, row.state.checkpoint),
								status: "needs_attention"
							} : row.state.checkpoint,
							message: "A background task was interrupted. Saved files are kept. Resume to retry the unfinished task."
						}, { generation: generation + 1 }),
						key: null
					};
				}
				const key = crypto.randomUUID();
				return {
					job: await write(client, row, {
						...row.state,
						status: row.state.status === "queued" ? "planning" : row.state.status
					}, { key }),
					key
				};
			});
		},
		async startOperation(id, generation, key, { kind, path = "" }) {
			return transaction(async (client) => {
				const row = await rowFor(client, id, { lock: true });
				if (row.generation !== generation || row.work_key !== key || !activeBuildStatus(row.state.status)) throw fail("This worker no longer owns the task.", 409);
				if (![
					"plan",
					"architecture",
					"generate",
					"review",
					"release"
				].includes(kind) || kind === "generate" && (!path || path !== row.state.checkpoint?.currentFile)) throw fail("Invalid coding operation.", 400);
				const cp = row.state.checkpoint || {};
				const binding = hash(canonical({
					kind,
					path,
					asked: row.state.asked,
					files: [...row.state.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
					plan: cp.plan || null,
					architecture: cp.architecture || null,
					repairs: cp.repairs || null,
					findings: cp.gateFindings || [],
					attempts: cp.fileAttempts || {},
					round: cp.reviewRound || 0
				}));
				const prior = row.state.operation;
				if (prior?.binding === binding && prior.status === "returned" && kind !== "release") return {
					reused: true,
					result: prior.result,
					id: prior.id
				};
				if (prior && ["started", "uncertain"].includes(prior.status)) throw Object.assign(fail("A previous AI operation has an uncertain outcome. Reconnect, then explicitly approve a retry; it may already have been charged.", 409), { code: "BUILD_OUTCOME_UNCERTAIN" });
				const operation = {
					version: 1,
					id: crypto.randomUUID(),
					generation,
					kind,
					path,
					binding,
					status: "started"
				};
				row.state.operation = operation;
				await write(client, row, row.state, { key });
				return {
					reused: false,
					id: operation.id
				};
			});
		},
		async finishOperation(id, generation, key, operationId, { result, status = "returned" } = {}) {
			return transaction(async (client) => {
				const row = await rowFor(client, id, { lock: true }), op = row.state.operation;
				if (row.generation !== generation || row.work_key !== key || op?.id !== operationId || op.status !== "started") throw fail("This operation no longer owns the task.", 409);
				if (![
					"returned",
					"denied",
					"uncertain"
				].includes(status)) throw fail("Invalid operation outcome.", 400);
				if (status === "returned" && (result === void 0 || Buffer.byteLength(JSON.stringify(result)) > 6e5)) throw fail("The response receipt is too large. Reconnect before retrying.", 413);
				row.state.operation = {
					...op,
					status,
					...status === "returned" ? {
						result: structuredClone(result),
						resultHash: hash(canonical(result))
					} : {}
				};
				return write(client, row, row.state, { key });
			});
		},
		async save(id, generation, key, state, { appliedOperation } = {}) {
			return transaction(async (client) => {
				const row = await rowFor(client, id, { lock: true });
				if (row.generation !== generation || row.work_key !== key) return {
					job: snapshot(row),
					saved: false
				};
				if (appliedOperation && row.state.operation?.id === appliedOperation && row.state.operation.status === "returned") {
					const { result, resultHash, ...op } = row.state.operation;
					row.state.operation = {
						...op,
						status: "applied"
					};
				}
				return {
					job: await write(client, row, {
						...state,
						workflowId: row.state.workflowId || state.workflowId
					}),
					saved: true
				};
			});
		},
		async progress(id, generation, key, state) {
			return transaction(async (client) => {
				const row = await rowFor(client, id, { lock: true });
				if (row.generation !== generation || row.work_key !== key) return {
					job: snapshot(row),
					saved: false
				};
				return {
					job: await write(client, row, {
						...state,
						workflowId: row.state.workflowId || state.workflowId
					}, { key }),
					saved: true
				};
			});
		},
		async control(id, token, action, options = {}) {
			validateBuildIdentity(id, token);
			return transaction(async (client) => {
				const row = await rowFor(client, id, {
					token,
					lock: true
				}), state = { ...row.state };
				if (options.generation != null && (!Number.isSafeInteger(options.generation) || options.generation !== row.generation)) throw fail("This task changed in another request. Refresh its saved state before trying again.", 409);
				if (action === "revise") {
					if (!Number.isSafeInteger(options.generation)) throw fail("A saved task generation is required before changing its request.", 400);
					if (activeBuildStatus(state.status)) throw fail("This cloud task is still active. Stop it before changing its request.", 409);
					const history = normalizeBuildRequests(options.requestHistory);
					if (typeof options.asked !== "string" || !options.asked.trim() || options.asked.length > 6e3 || !Array.isArray(options.files)) throw fail("A valid task brief and source are required.", 400);
					if (history && buildRequestBrief(history) !== options.asked.trim()) throw fail("The request history does not match this task brief.", 400);
					if (state.requestHistory) {
						const old = normalizeBuildRequests(state.requestHistory);
						if (!history || old.origin !== history.origin || old.entries.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(history.entries[index]))) throw fail("Saved request history must be preserved when changing a task.", 400);
					} else if (history && history.entries[0].text !== state.asked.trim()) throw fail("Keep the original saved brief when recording legacy task history.", 400);
					delete row.state.operation;
					delete state.operation;
					const ledger = requirementLedgerFor(state);
					if (ledger) state.requirementLedger = ledger;
					state.previousCheckpoint = state.checkpoint || null;
					Object.assign(state, {
						asked: options.asked.trim(),
						files: options.files,
						checkpoint: options.checkpoint || null,
						requestHistory: history,
						status: "queued",
						message: "Requested changes saved. Continuing from the current source.",
						workflowId: null
					});
				} else if ([
					"stop",
					"pause",
					"cancel"
				].includes(action)) {
					if (state.status === "stopped" || state.status === "approved") return {
						job: snapshot(row),
						start: false
					};
					state.status = "stopped";
					state.message = action === "cancel" ? "Cancelled. Completed files and request history are saved." : action === "pause" ? "Paused. Completed files are saved. Resume when ready." : "Stopped. Completed files are saved.";
					if (state.checkpoint) state.checkpoint = {
						...state.checkpoint,
						status: "stopped"
					};
				} else if (action === "resume") {
					if (activeBuildStatus(state.status) || state.status === "approved") return {
						job: snapshot(row),
						start: false
					};
					if (["started", "uncertain"].includes(row.state.operation?.status)) {
						if (options.acknowledgeUncertain !== true) throw Object.assign(fail("The previous AI operation may already have been charged. Explicit retry approval is required.", 409), { code: "BUILD_OUTCOME_UNCERTAIN" });
						row.state.operation = {
							...row.state.operation,
							status: "retry_authorized"
						};
					}
					state.status = "queued";
					state.message = "Resuming from saved files.";
					state.workflowId = null;
					if (state.checkpoint) state.checkpoint = {
						...state.checkpoint,
						faults: [],
						release: null,
						blocker: null,
						message: ""
					};
				} else throw fail("Choose pause, cancel, stop, resume or revise.", 400);
				state.events = [...state.events || [], {
					at: Date.now(),
					message: state.message
				}].slice(-200);
				return {
					job: await write(client, row, state, { generation: row.generation + 1 }),
					start: action === "resume" || action === "revise"
				};
			});
		},
		async remove(id, token) {
			validateBuildIdentity(id, token);
			return transaction(async (client) => {
				const row = await rowFor(client, id, {
					token,
					lock: true
				});
				if (activeBuildStatus(row.state.status)) throw fail("Stop this cloud task before deleting it.", 409);
				await client.query("DELETE FROM public.grandpa_ai_build_jobs WHERE id=$1 AND scope=$2", [id, scope]);
				return true;
			});
		},
		close: () => pool.end()
	};
}
// server/background-store.js
var background_store_exports = /* @__PURE__ */ __exportAll({ buildJobStore: () => buildJobStore });
const connectionString = process.env.RITUAL_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
const buildJobStore = connectionString ? createBuildJobStore({ connectionString }) : null;
export { activeBuildStatus, background_store_exports, buildBlocker, buildJobStore, carryMissingRequirements, createPostgresGovernanceStorage, governanceScope, missingRequirements, nextRequirementLedger, postgresPoolOptions, postgresTransaction, requireBuildGeneration, requirementLedgerFor, requirementPrompt, unchangedBuildJob };
