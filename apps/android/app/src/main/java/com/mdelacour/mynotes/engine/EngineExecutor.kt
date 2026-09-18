package com.mdelacour.mynotes.engine

import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext

class EngineExecutor {
	private val dispatcherImpl =
		Executors.newSingleThreadExecutor { Thread(it, "mynotes-engine") }.asCoroutineDispatcher()

	val dispatcher: CoroutineDispatcher = dispatcherImpl

	private var closed = false

	suspend fun <T> run(block: () -> T): T = withContext(dispatcher) { block() }

	fun close() {
		if (closed) return
		closed = true
		dispatcherImpl.close()
	}
}
