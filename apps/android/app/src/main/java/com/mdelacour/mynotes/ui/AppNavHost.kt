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
import com.mdelacour.mynotes.ui.settings.AiKeysScreen
import com.mdelacour.mynotes.ui.settings.AiKeysViewModel
import com.mdelacour.mynotes.ui.settings.SettingsScreen
import com.mdelacour.mynotes.ui.settings.SettingsViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

const val SESSIONS_ROUTE = "sessions"
const val EDITOR_ROUTE = "editor/{localId}?noteId={noteId}"
const val SETTINGS_ROUTE = "settings"
const val AI_KEYS_ROUTE = "ai-keys"

private const val LOCAL_ID = "localId"
private const val NOTE_ID = "noteId"

fun editorRoute(localId: String, noteId: String? = null): String =
	if (noteId.isNullOrBlank()) "editor/$localId" else "editor/$localId?noteId=$noteId"

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
					viewModel.handleIncomingLink(link)
					onLinkConsumed()
				}
			}

			SessionListScreen(
				viewModel = viewModel,
				onOpenSession = { localId, noteId ->
					navController.navigate(editorRoute(localId, noteId)) {
						launchSingleTop = true
					}
				},
				onOpenSettings = { navController.navigate(SETTINGS_ROUTE) },
			)
		}
		composable(SETTINGS_ROUTE) {
			val viewModel: SettingsViewModel =
				viewModel(factory = SettingsViewModel.factory(graph))
			SettingsScreen(
				viewModel = viewModel,
				onBack = { navController.popBackStack() },
				onOpenAiKeys = { navController.navigate(AI_KEYS_ROUTE) },
			)
		}
		composable(AI_KEYS_ROUTE) {
			val viewModel: AiKeysViewModel =
				viewModel(factory = AiKeysViewModel.factory(graph))
			AiKeysScreen(viewModel = viewModel, onBack = { navController.popBackStack() })
		}
		composable(
			route = EDITOR_ROUTE,
			arguments = listOf(
				navArgument(LOCAL_ID) { type = NavType.StringType },
				navArgument(NOTE_ID) {
					type = NavType.StringType
					nullable = true
					defaultValue = null
				},
			),
		) { entry ->
			val localId = entry.arguments?.getString(LOCAL_ID).orEmpty()
			val noteId = entry.arguments?.getString(NOTE_ID)
			val viewModel: EditorViewModel =
				viewModel(factory = EditorViewModel.factory(graph, localId, noteId))
			EditorScreen(
				viewModel = viewModel,
				onBack = { navController.popBackStack() },
				onOpenAiKeys = { navController.navigate(AI_KEYS_ROUTE) },
			)
		}
	}
}
