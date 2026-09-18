package com.mdelacour.mynotes.sync

import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections

/**
 * Loopback TCP proxy that can drop its upstream connection without telling the downstream
 * client. Models a phone socket that dies with no close event: the client's TCP stays open
 * and silent while the peer is gone.
 */
class FreezableTcpProxy(
	private val upstreamHost: String,
	private val upstreamPort: Int,
) : AutoCloseable {
	private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
	private val connections = Collections.synchronizedList(mutableListOf<Connection>())
	@Volatile
	private var running = true

	val port: Int get() = server.localPort

	init {
		Thread {
			while (running) {
				val client = try {
					server.accept()
				} catch (_: IOException) {
					break
				}
				val upstream = try {
					Socket(upstreamHost, upstreamPort)
				} catch (_: IOException) {
					runCatching { client.close() }
					continue
				}
				val connection = Connection(client, upstream)
				connections += connection
				connection.start()
			}
		}.apply { isDaemon = true }.start()
	}

	fun freeze() {
		connections.forEach { it.freeze() }
	}

	override fun close() {
		running = false
		runCatching { server.close() }
		connections.forEach { it.close() }
	}

	private class Connection(private val client: Socket, private val upstream: Socket) {
		@Volatile
		private var frozen = false

		fun start() {
			pump(client, upstream)
			pump(upstream, client)
		}

		fun freeze() {
			frozen = true
			runCatching { upstream.close() }
		}

		fun close() {
			runCatching { client.close() }
			runCatching { upstream.close() }
		}

		private fun pump(from: Socket, to: Socket) {
			Thread {
				val buffer = ByteArray(16 * 1024)
				try {
					val input = from.getInputStream()
					val output = to.getOutputStream()
					while (true) {
						val read = input.read(buffer)
						if (read == -1) break
						output.write(buffer, 0, read)
						output.flush()
					}
				} catch (_: IOException) {
					// expected once the connection is frozen or closed
				} finally {
					if (!frozen) {
						runCatching { client.close() }
						runCatching { upstream.close() }
					}
				}
			}.apply { isDaemon = true }.start()
		}
	}
}
