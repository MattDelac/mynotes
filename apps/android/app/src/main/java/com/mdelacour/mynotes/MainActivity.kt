package com.mdelacour.mynotes

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.mdelacour.mynotes.ui.AppNavHost
import com.mdelacour.mynotes.ui.theme.MyNotesTheme
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
	private val pendingLink = MutableStateFlow<String?>(null)

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		enableEdgeToEdge()
		pendingLink.value = linkFromIntent(intent)
		setContent {
			MyNotesTheme {
				AppNavHost(
					pendingLink = pendingLink,
					onLinkConsumed = { pendingLink.value = null },
				)
			}
		}
	}

	override fun onNewIntent(intent: Intent) {
		super.onNewIntent(intent)
		setIntent(intent)
		linkFromIntent(intent)?.let { pendingLink.value = it }
	}

	private fun linkFromIntent(intent: Intent?): String? = when (intent?.action) {
		Intent.ACTION_SEND ->
			intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }

		Intent.ACTION_VIEW -> intent.data?.toString()
		else -> null
	}
}
