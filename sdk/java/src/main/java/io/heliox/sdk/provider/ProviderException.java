package io.heliox.sdk.provider;

/** Raised when an LLM provider returns a non-2xx response or an unparseable body. */
public class ProviderException extends RuntimeException {

    public ProviderException(String message) {
        super(message);
    }

    public ProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
