package com.mdelacour.mynotes.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.mdelacour.mynotes.ui.sessions.SessionListScreen

const val SESSIONS_ROUTE = "sessions"

@Composable
fun AppNavHost() {
	val navController = rememberNavController()
	NavHost(navController = navController, startDestination = SESSIONS_ROUTE) {
		composable(SESSIONS_ROUTE) {
			SessionListScreen()
		}
	}
}
