package com.mdelacour.mynotes.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.mdelacour.mynotes.MyNotesApp
import com.mdelacour.mynotes.ui.editor.EditorScreen
import com.mdelacour.mynotes.ui.editor.EditorViewModel
import com.mdelacour.mynotes.ui.sessions.SessionListScreen
import com.mdelacour.mynotes.ui.sessions.SessionListViewModel
import com.mdelacour.mynotes.ui.settings.SettingsScreen
import com.mdelacour.mynotes.ui.settings.SettingsViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

const val SESSIONS_ROUTE = "sessions"
const val EDITOR_ROUTE = "editor/{localId}"
const val SETTINGS_ROUTE = "settings"

private const val LOCAL_ID = "localId"

fun editorRoute(localId: String): String = "editor/$localId"

private val NoIncomingLink = MutableStateFlow<String?>(null)

@Composable
fun AppNavHost(
	pendingLink: StateFlow<String?> = NoIncomingLink,
	onLinkConsumed: () -> Unit = {},
) {
	val navController = rememberNavController()
	val context = LocalContext.current
	val graph = remember(context) { (context.applicationContext as MyNotesApp).graph }

	NavHost(navController = navController, startDestination = SESSIONS_ROUTE) {
		composable(SESSIONS_ROUTE) {
			val viewModel: SessionListViewModel =
				viewModel(factory = SessionListViewModel.factory(graph))
			val incomingLink by pendingLink.collectAsStateWithLifecycle()

			LaunchedEffect(incomingLink) {
				val link = incomingLink
				if (link != null) {
					viewModel.importLink(link)
					onLinkConsumed()
				}
			}

			SessionListScreen(
				viewModel = viewModel,
				onOpenSession = { localId -> navController.navigate(editorRoute(localId)) },
				onOpenSettings = { navController.navigate(SETTINGS_ROUTE) },
			)
		}
		composable(SETTINGS_ROUTE) {
			val viewModel: SettingsViewModel =
				viewModel(factory = SettingsViewModel.factory(graph))
			SettingsScreen(viewModel = viewModel, onBack = { navController.popBackStack() })
		}
		composable(
			route = EDITOR_ROUTE,
			arguments = listOf(navArgument(LOCAL_ID) { type = NavType.StringType }),
		) { entry ->
			val localId = entry.arguments?.getString(LOCAL_ID).orEmpty()
			val viewModel: EditorViewModel =
				viewModel(factory = EditorViewModel.factory(graph, localId))
			EditorScreen(viewModel = viewModel, onBack = { navController.popBackStack() })
		}
	}
}
