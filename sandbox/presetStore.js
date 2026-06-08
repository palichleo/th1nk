const { createHash, randomBytes } = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const ALLOWED_KINDS = new Set(["layers", "bots"]);
const PRESET_FILE_PATTERN = /^[a-f0-9]{64}\.json$/;

function createPresetStore({ dataDirectory } = {}) {
  const rootDirectory = resolveRootDirectory(dataDirectory);

  return {
    async list(kind) {
      const kindDirectory = getKindDirectory(rootDirectory, kind);

      try {
        await fs.mkdir(kindDirectory, { recursive: true });
        const entries = await fs.readdir(kindDirectory, { withFileTypes: true });
        const presets = [];

        for (const entry of entries) {
          if (!entry.isFile() || !PRESET_FILE_PATTERN.test(entry.name)) {
            continue;
          }

          const filePath = path.join(kindDirectory, entry.name);
          const preset = await readPresetFile(filePath);
          assertStoredPresetMatchesFile(preset, entry.name, filePath);
          presets.push(preset);
        }

        return presets.sort(comparePresetNames);
      } catch (error) {
        throw wrapError(`Unable to list "${kind}" presets`, error);
      }
    },

    async get(kind, name) {
      const filePath = getPresetPath(rootDirectory, kind, name);

      try {
        const preset = await readPresetFile(filePath);
        assertStoredPresetName(preset, name, filePath);
        return preset;
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }

        throw wrapError(`Unable to get "${kind}" preset "${name}"`, error);
      }
    },

    async save(kind, preset) {
      const storedPreset = toJsonPreset(preset);
      const filePath = getPresetPath(rootDirectory, kind, storedPreset.name);
      const kindDirectory = path.dirname(filePath);
      const temporaryPath = createTemporaryPath(filePath);

      try {
        await fs.mkdir(kindDirectory, { recursive: true });
        await fs.writeFile(temporaryPath, `${JSON.stringify(storedPreset, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx"
        });
        await fs.rename(temporaryPath, filePath);
        return cloneJson(storedPreset);
      } catch (error) {
        await removeTemporaryFile(temporaryPath);
        throw wrapError(
          `Unable to save "${kind}" preset "${storedPreset.name}"`,
          error
        );
      }
    },

    async remove(kind, name) {
      const filePath = getPresetPath(rootDirectory, kind, name);

      try {
        await fs.unlink(filePath);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") {
          return false;
        }

        throw wrapError(`Unable to remove "${kind}" preset "${name}"`, error);
      }
    }
  };
}

function resolveRootDirectory(dataDirectory) {
  if (typeof dataDirectory !== "string" || !dataDirectory.trim()) {
    throw new TypeError("dataDirectory must be a non-empty path string.");
  }

  return path.resolve(dataDirectory, "presets");
}

function getKindDirectory(rootDirectory, kind) {
  assertKind(kind);
  return path.join(rootDirectory, kind);
}

function getPresetPath(rootDirectory, kind, name) {
  assertPresetName(name);
  return path.join(getKindDirectory(rootDirectory, kind), createPresetFileName(name));
}

function assertKind(kind) {
  if (!ALLOWED_KINDS.has(kind)) {
    throw new TypeError(
      `Invalid preset kind "${String(kind)}". Expected "layers" or "bots".`
    );
  }
}

function assertPresetName(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new TypeError("Preset name must be a non-empty string.");
  }
}

function createPresetFileName(name) {
  return `${createHash("sha256").update(name, "utf16le").digest("hex")}.json`;
}

function createTemporaryPath(filePath) {
  const suffix = `${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  return `${filePath}.${suffix}.tmp`;
}

async function readPresetFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");

  try {
    const preset = JSON.parse(content);
    assertPreset(preset);
    return preset;
  } catch (error) {
    throw wrapError(`Invalid preset file "${filePath}"`, error);
  }
}

function assertPreset(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
    throw new TypeError("Preset must be a JSON object.");
  }

  assertPresetName(preset.name);
}

function assertStoredPresetName(preset, expectedName, filePath) {
  if (preset.name !== expectedName) {
    throw new Error(
      `Preset file "${filePath}" contains name "${preset.name}" instead of "${expectedName}".`
    );
  }
}

function assertStoredPresetMatchesFile(preset, fileName, filePath) {
  if (createPresetFileName(preset.name) !== fileName) {
    throw new Error(`Preset file "${filePath}" does not match its stored name.`);
  }
}

function toJsonPreset(preset) {
  assertPreset(preset);

  let cloned;

  try {
    cloned = cloneJson(preset);
  } catch (error) {
    throw wrapError(`Preset "${preset.name}" is not JSON serializable`, error);
  }

  assertPreset(cloned);
  return cloned;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function comparePresetNames(left, right) {
  if (left.name < right.name) {
    return -1;
  }

  if (left.name > right.name) {
    return 1;
  }

  return 0;
}

async function removeTemporaryFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // The original write or rename error is more useful to the caller.
  }
}

function wrapError(message, cause) {
  const error = new Error(`${message}: ${cause.message}`);
  error.cause = cause;

  if (cause.code) {
    error.code = cause.code;
  }

  return error;
}

module.exports = {
  createPresetStore
};
