package com.mdelacour.mynotes

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.mdelacour.mynotes.ui.AppNavHost
import com.mdelacour.mynotes.ui.theme.MyNotesTheme

class MainActivity : ComponentActivity() {
	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		enableEdgeToEdge()
		setContent {
			MyNotesTheme {
				AppNavHost()
			}
		}
	}
}
