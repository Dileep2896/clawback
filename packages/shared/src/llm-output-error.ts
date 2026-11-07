/** The run worked but its output was unusable. Unlike a login or quota failure, this says something about the input, so a parser may retry. */
export class LlmOutputError extends Error {}
