package com.mdelacour.mynotes.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
	primary = Color(0xFF3F51B5),
	onPrimary = Color.White,
	secondary = Color(0xFF5C6BC0),
)

private val DarkColors = darkColorScheme(
	primary = Color(0xFF9FA8DA),
	onPrimary = Color(0xFF1A237E),
	secondary = Color(0xFF7986CB),
)

@Composable
fun MyNotesTheme(
	darkTheme: Boolean = isSystemInDarkTheme(),
	content: @Composable () -> Unit,
) {
	val colors = when {
		Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
			val context = LocalContext.current
			if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
		}
		darkTheme -> DarkColors
		else -> LightColors
	}
	MaterialTheme(colorScheme = colors, content = content)
}
