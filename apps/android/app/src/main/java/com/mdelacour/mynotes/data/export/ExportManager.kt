package com.mdelacour.mynotes.data.export

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.mdelacour.mynotes.domain.ExportFilename
import java.io.File
import java.io.IOException

object ExportFiles {
	fun uniqueTarget(dir: File, filename: String): File {
		val direct = File(dir, filename)
		if (!direct.exists()) return direct
		val dot = filename.lastIndexOf('.')
		val stem = if (dot > 0) filename.substring(0, dot) else filename
		val extension = if (dot > 0) filename.substring(dot) else ""
		var index = 1
		while (true) {
			val candidate = File(dir, "$stem-$index$extension")
			if (!candidate.exists()) return candidate
			index++
		}
	}

	fun writeUnique(dir: File, filename: String, content: String): File {
		if (!dir.exists()) dir.mkdirs()
		val target = uniqueTarget(dir, filename)
		target.writeText(content, Charsets.UTF_8)
		return target
	}

	fun prune(dir: File, cutoff: Long): Int {
		if (!dir.isDirectory) return 0
		val children = dir.listFiles() ?: return 0
		var removed = 0
		for (child in children) {
			if (child.isFile && child.lastModified() < cutoff && child.delete()) removed++
		}
		return removed
	}
}

class ExportManager(
	private val context: Context,
	private val clock: () -> Long = System::currentTimeMillis,
) {
	fun suggestedFilename(content: String): String = ExportFilename.of(content)

	fun writeShareFile(content: String): File =
		ExportFiles.writeUnique(File(context.cacheDir, EXPORTS_DIR), suggestedFilename(content), content)

	fun writeToUri(content: String, uri: Uri) {
		val stream = context.contentResolver.openOutputStream(uri)
			?: throw IOException("could not open export destination")
		stream.use { it.write(content.toByteArray(Charsets.UTF_8)) }
	}

	fun pruneStale(ttlMs: Long = DEFAULT_TTL_MS): Int =
		ExportFiles.prune(File(context.cacheDir, EXPORTS_DIR), clock() - ttlMs)

	fun shareIntent(file: File): Intent {
		val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
		return Intent(Intent.ACTION_SEND).apply {
			type = "text/markdown"
			putExtra(Intent.EXTRA_STREAM, uri)
			clipData = ClipData.newUri(context.contentResolver, file.name, uri)
			addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
		}
	}

	companion object {
		const val EXPORTS_DIR = "exports"
		const val DEFAULT_TTL_MS = 24L * 60L * 60L * 1000L
	}
}
