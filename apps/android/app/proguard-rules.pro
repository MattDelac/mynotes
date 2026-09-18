# gomobile keeps its JNI-facing classes by name; its AAR ships the consumer rules
# for that. Keep the engine facade explicitly as a belt-and-braces measure.
-keep class com.mdelacour.mynotes.engine.** { *; }
-keep class go.** { *; }
