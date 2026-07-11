package io.fluxor.sdk.mod.builtin;

import io.fluxor.sdk.mod.ModContext;
import io.fluxor.sdk.mod.StepMod;

import java.util.regex.Pattern;

/**
 * Rewrites the model's raw text output with a regular-expression replacement — the Java
 * analogue of the TS {@code post_process} mod kind, made mechanically real (see
 * {@link StepMod}'s class Javadoc for why that is a deliberate divergence from the current TS
 * engine, where {@code post_process} is only a prompt hint). Applied by {@code StepExecutor}
 * before schema validation/parsing, so the replacement can fix up model output the schema would
 * otherwise reject.
 */
public final class RegexPostProcessMod implements StepMod {

    private final Pattern pattern;
    private final String replacement;

    public RegexPostProcessMod(String regex, String replacement) {
        this.pattern = Pattern.compile(regex);
        this.replacement = replacement;
    }

    @Override
    public String id() {
        return "regex-post-process";
    }

    @Override
    public String onResponseText(String text, ModContext ctx) {
        return pattern.matcher(text).replaceAll(replacement);
    }
}
