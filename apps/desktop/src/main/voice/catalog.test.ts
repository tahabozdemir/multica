// @vitest-environment node
import { expect, it } from "vitest";
import { MODEL_MIRRORS, modelMirrors } from "./catalog";

it("downloads speech models from Hugging Face only in a privacy build", () => {
  expect(modelMirrors(true)).toEqual(["https://huggingface.co"]);
  expect(MODEL_MIRRORS).toEqual(["https://huggingface.co"]);
});

it("keeps upstream's mirror fallback when privacy mode is off", () => {
  expect(modelMirrors(false)).toEqual(["https://huggingface.co", "https://hf-mirror.com"]);
});
