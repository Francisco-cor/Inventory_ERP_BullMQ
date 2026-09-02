export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "ci",
        "perf",
        "security",
        "revert",
        "build",
      ],
    ],
    "scope-enum": [0, "always", []],
    "subject-case": [0],
  },
};
