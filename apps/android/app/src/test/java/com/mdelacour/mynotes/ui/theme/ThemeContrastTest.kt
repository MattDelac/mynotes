package com.mdelacour.mynotes.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import java.util.Locale
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeContrastTest {
	private data class PairResult(val name: String, val ratio: Double)

	private fun relativeLuminance(color: Color): Double {
		fun channel(value: Float): Double {
			val c = value.toDouble()
			return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
		}
		return 0.2126 * channel(color.red) +
			0.7152 * channel(color.green) +
			0.0722 * channel(color.blue)
	}

	private fun contrast(a: Color, b: Color): Double {
		val la = relativeLuminance(a)
		val lb = relativeLuminance(b)
		val lighter = maxOf(la, lb)
		val darker = minOf(la, lb)
		return (lighter + 0.05) / (darker + 0.05)
	}

	private fun pairs(scheme: ColorScheme): List<PairResult> = listOf(
		PairResult("onBackground/background", contrast(scheme.onBackground, scheme.background)),
		PairResult("onSurface/surface", contrast(scheme.onSurface, scheme.surface)),
		PairResult(
			"onSurfaceVariant/surfaceVariant",
			contrast(scheme.onSurfaceVariant, scheme.surfaceVariant),
		),
		PairResult("onPrimary/primary", contrast(scheme.onPrimary, scheme.primary)),
		PairResult(
			"onSecondaryContainer/secondaryContainer",
			contrast(scheme.onSecondaryContainer, scheme.secondaryContainer),
		),
		PairResult("onError/error", contrast(scheme.onError, scheme.error)),
		PairResult(
			"onErrorContainer/errorContainer",
			contrast(scheme.onErrorContainer, scheme.errorContainer),
		),
	)

	@Test
	fun lightSchemeMeetsWcagContrast() {
		assertContrast("light", pairs(LightColors))
	}

	@Test
	fun darkSchemeMeetsWcagContrast() {
		assertContrast("dark", pairs(DarkColors))
	}

	private fun assertContrast(label: String, results: List<PairResult>) {
		val report = results.joinToString("\n") { format(it) }
		println("$label contrast ratios:\n$report")
		for (result in results) {
			val minimum = if (result.ratio < 4.5) 3.0 else 4.5
			assertTrue(
				"$label ${result.name} contrast ${ratioLabel(result.ratio)} < $minimum",
				result.ratio >= minimum,
			)
		}
	}

	private fun format(result: PairResult): String = "${result.name}=${ratioLabel(result.ratio)}"

	private fun ratioLabel(ratio: Double): String = String.format(Locale.US, "%.2f", ratio)
}
