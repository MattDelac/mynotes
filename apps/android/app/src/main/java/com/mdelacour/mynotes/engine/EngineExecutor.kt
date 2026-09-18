package com.mdelacour.mynotes.engine

import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext

class EngineExecutor(dispatcher: CoroutineDispatcher? = null) {
	private val owned: ExecutorCoroutineDispatcher? =
		if (dispatcher == null) {
			Executors.newSingleThreadExecutor { Thread(it, "mynotes-engine") }.asCoroutineDispatcher()
		} else {
			null
		}

	val dispatcher: CoroutineDispatcher = dispatcher ?: owned!!

	private var closed = false

	suspend fun <T> run(block: () -> T): T = withContext(dispatcher) { block() }

	fun close() {
		if (closed) return
		closed = true
		owned?.close()
	}
}
