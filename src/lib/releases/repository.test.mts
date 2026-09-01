import assert from "node:assert/strict";
import test from "node:test";

import { parsePublicRepositoryUrl } from "./repository.ts";

function parseOk(url: string) {
  const result = parsePublicRepositoryUrl(url);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.reference;
}

function parseError(url: string) {
  const result = parsePublicRepositoryUrl(url);
  assert.equal(result.ok, false, JSON.stringify(result));
  return result.error;
}

test("parses valid GitHub repository URLs", () => {
  assert.deepEqual(parseOk("https://github.com/example/project"), {
    provider: "github",
    host: "github.com",
    namespace: "example",
    repository: "project",
    fullPath: "example/project",
    url: "https://github.com/example/project",
  });

  assert.equal(parseOk("https://github.com/example/project/").url, "https://github.com/example/project");
  assert.equal(parseOk("https://github.com/example/project.git").repository, "project");
});

test("parses valid GitLab repository URLs including nested namespaces", () => {
  assert.equal(parseOk("https://gitlab.com/example/project").fullPath, "example/project");
  assert.equal(parseOk("https://gitlab.com/example/subgroup/project").namespace, "example/subgroup");
  assert.equal(parseOk("https://gitlab.com/a/b/c/d/project.git").fullPath, "a/b/c/d/project");
});

test("rejects invalid and unsafe repository URLs", () => {
  for (const url of [
    "http://github.com/example/project",
    "https://github.com/example",
    "https://github.com/example/project/issues",
    "https://github.com/example/project%2Fother",
    "https://github.com/example/project%20name",
    "https://user:pass@github.com/example/project",
    "javascript:alert(1)",
    "file:///tmp/repo",
    "data:text/plain,repo",
    "https://localhost/example/project",
    "https://127.0.0.1/example/project",
    "https://gitlab.example.com/example/project",
  ]) {
    const error = parseError(url);
    assert.ok(error.code === "INVALID_REPOSITORY_URL" || error.code === "UNSUPPORTED_REPOSITORY_PROVIDER", url);
  }
});

test("classifies unsupported providers distinctly", () => {
  assert.equal(parseError("https://bitbucket.org/example/project").code, "UNSUPPORTED_REPOSITORY_PROVIDER");
});
