import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

// --- VERCEL ENVIRONMENT VARIABLES (Reading Supabase Config) ---
const VERCEL_APP_ID = import.meta.env.VITE_APP_ID || 'default-app-id';
const VERCEL_OWNER_ID = import.meta.env.VITE_APP_OWNER_ID || null;

// Supabase configuration must read from Vercel's environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Initialize Supabase Client
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// --- Utility Functions ---

// Debounce function to limit function calls
const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

/**
 * Custom hook for managing Supabase user sessions.
 */
const useSupabaseAuth = () => {
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isAppOwner, setIsAppOwner] = useState(false);

    useEffect(() => {
        if (!supabase) {
            console.error("Supabase client is not initialized. Check Vercel environment variables.");
            setIsAuthReady(true);
            return;
        }

        // Supabase doesn't need anonymous sign-in like Firebase. 
        // We simulate a stable user ID using Local Storage for persistence across sessions.
        const storedUserId = localStorage.getItem('portfolio_user_id');
        const generatedId = storedUserId || crypto.randomUUID();
        localStorage.setItem('portfolio_user_id', generatedId);

        setUserId(generatedId);
        setIsAuthReady(true);

        // --- OWNER CHECK ---
        if (VERCEL_OWNER_ID && generatedId === VERCEL_OWNER_ID) {
            setIsAppOwner(true);
        }

        // Log the ID for security setup (This is the final purpose of this logger)
        if (!VERCEL_OWNER_ID) {
             console.log("SIMULATED USER ID (COPY ME):", generatedId);
        }
        
    }, []);

    return { userId, isAuthReady, isAppOwner };
};


// --- SUPABASE DATA HOOK ---

/**
 * Custom hook to manage project data fetching and actions (Create/Update/Delete) via Supabase.
 */
const useProjects = ({ userId, isAuthReady }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Supabase table name
    const TABLE_NAME = 'projects';

    // 1. Fetching Projects (Real-time Subscription)
    useEffect(() => {
        if (!isAuthReady || !supabase || !userId) {
            setLoading(true);
            return;
        }

        // Function to fetch data from the projects table where owner_id matches our userId
        const fetchProjects = async () => {
            try {
                // Filter by owner_id and order by created_at
                const { data, error } = await supabase
                    .from(TABLE_NAME)
                    .select('*')
                    .eq('owner_id', userId)
                    .order('created_at', { ascending: false }); 
                
                if (error) throw error;
                
                setProjects(data.map(p => ({
                    id: p.id,
                    ...p,
                    createdAt: new Date(p.created_at) // Convert string to Date object
                })));
                setError(null);
            } catch (err) {
                // Initial failure will occur if the 'projects' table doesn't exist yet.
                console.error("Error fetching projects from Supabase (Check Table/RLS setup):", err);
                setError("Failed to load projects. Ensure the 'projects' table is created in Supabase.");
            } finally {
                setLoading(false);
            }
        };

        // Supabase Real-time listener (fires on initial fetch and subsequent changes)
        const channel = supabase
            .channel('public_projects_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: TABLE_NAME }, () => {
                fetchProjects(); // Re-fetch data on any change
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    fetchProjects(); // Initial fetch
                }
            });
        

        // Cleanup function for the channel subscription
        return () => {
            supabase.removeChannel(channel);
        };
    }, [userId, isAuthReady]); 

    // 2. Adding a Project
    const addProject = useCallback(async (newProject) => {
        if (!supabase || !userId) {
            setError("Error: Supabase not ready or User ID missing.");
            return;
        }
        
        try {
            const { error } = await supabase
                .from(TABLE_NAME)
                .insert({
                    ...newProject,
                    owner_id: userId, // CRITICAL: Link project to the owner
                    // Supabase automatically sets created_at if default is set
                });
            
            if (error) throw error;
            setError(null);
        } catch (err) {
            console.error("Error adding project to Supabase:", err);
            setError("Failed to add project. Ensure table and RLS policies are correct.");
        }
    }, [userId]);

    // 3. Updating a Project
    const updateProject = useCallback(async (id, updatedFields) => {
        if (!supabase || !userId) {
            setError("Error: Supabase not ready or User ID missing.");
            return;
        }
        
        try {
            // UpdatedFields should not include the ID
            const fieldsToUpdate = { ...updatedFields };
            delete fieldsToUpdate.id; 

            const { error } = await supabase
                .from(TABLE_NAME)
                .update(fieldsToUpdate)
                .eq('id', id);
            
            if (error) throw error;
            setError(null);
        } catch (err) {
            console.error("Error updating project in Supabase:", err);
            setError("Failed to save changes. Check RLS policies.");
        }
    }, [userId]);

    // 4. Deleting a Project
    const deleteProject = useCallback(async (id) => {
        if (!supabase || !userId) {
            setError("Error: Supabase not ready or User ID missing.");
            return;
        }
        
        try {
            const { error } = await supabase
                .from(TABLE_NAME)
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            setError(null);
        } catch (err) {
            console.error("Error deleting project from Supabase:", err);
            setError("Failed to delete project. Check RLS policies.");
        }
    }, [userId]);

    return { projects, addProject: debounce(addProject, 300), updateProject, deleteProject, error, loading };
};


// --- APPLICATION COMPONENTS (Visuals and Interaction) ---

const LinkButton = ({ href, icon, label }) => {
    if (!href || href === '#') return null;

    const safeHref = href.startsWith('http') ? href : `https://${href}`;

    return (
        <a 
            href={safeHref} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center space-x-1 px-3 py-1 bg-gray-700 hover:bg-cyan-600 text-white rounded-lg text-sm transition-colors font-medium"
        >
            {icon}
            <span>{label}</span>
        </a>
    );
};

const ProjectCard = ({ project, onDelete, onEdit, isManagerMode }) => ( 
    <div className="bg-gray-800 p-6 rounded-xl shadow-2xl transition-all duration-300 hover:shadow-cyan-500/30 border border-gray-700 hover:scale-[1.03]"> 
        <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl font-bold text-cyan-400">{project.title}</h3>
            {isManagerMode && ( 
                <div className="flex space-x-2">
                    {/* EDIT BUTTON */}
                    <button
                        onClick={() => onEdit(project)}
                        className="p-1 text-sm text-yellow-400 hover:text-yellow-500 transition-colors"
                        aria-label="Edit project"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zm-3.182 8.618l-3.232 3.232 1.414 1.414 3.232-3.232-1.414-1.414zM4 14v4h4l9.5-9.5-4-4L4 14z"/>
                        </svg>
                    </button>
                    {/* DELETE BUTTON */}
                    <button
                        onClick={() => onDelete(project.id)}
                        className="p-1 text-sm text-red-400 hover:text-red-500 transition-colors"
                        aria-label="Delete project"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 011-1v6a1 1 01-1 1V7z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
        <p className="text-gray-400 mb-4 text-sm whitespace-pre-wrap">{project.description}</p>
        
        {/* Project Links (GitHub and Live Demo) */}
        <div className="flex flex-wrap gap-3 mb-4">
             <LinkButton 
                href={project.githubUrl} 
                icon={(
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.542-1.361-1.329-1.725-1.329-1.725-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.303.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.046.138 3.003.404 2.292-1.552 3.3-1.23 3.3-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.785 24 17.306 24 12 24 5.373 18.627 0 12 0z"/></svg>
                )} 
                label="GitHub" 
            />
             <LinkButton 
                href={project.liveDemoUrl} 
                icon={(
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
                )} 
                label="Live Demo" 
            />
        </div>

        {/* Technologies Tags */}
        <div className="flex flex-wrap gap-2 text-xs">
            {project.technologies?.split(',').map((tech, index) => (
                <span key={index} className="bg-cyan-900/40 text-cyan-300 px-3 py-1 rounded-full font-medium">
                    {tech.trim()}
                </span>
            ))}
        </div>
        
        {project.createdAt && (
            <p className="text-gray-500 text-xs mt-4">
                Added on: {new Date(project.createdAt).toLocaleDateString()}
            </p>
        )}
    </div>
);

// --- GEMINI API INTEGRATION COMPONENT ---
const ProjectDraftingTool = ({ title, technologies, setDescription }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateProjectDescription = useCallback(async () => {
        if (!title || !technologies) {
            setError("Please fill in the Title and Technologies fields first.");
            return;
        }

        setIsLoading(true);
        setError(null);
        
        const systemPrompt = "You are a professional technical writer for a developer's portfolio. Your task is to generate a concise, engaging, and professional 3-4 sentence description for a technical project. The description must be in plain text, and not include any headings or bullet points. Focus on highlighting the core function and the technologies used.";
        const userQuery = `Generate a description for a project titled: "${title}". Key Technologies used: ${technologies}.`;
        
        const apiKey = ""; 
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const MAX_RETRIES = 3;
        const INITIAL_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`API call failed with status: ${response.status}`);
                }

                const result = await response.json();
                const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text) {
                    setDescription(text.trim());
                    setIsLoading(false);
                    return; // Success
                } else {
                    throw new Error("Received empty content from the API.");
                }

            } catch (err) {
                if (attempt === MAX_RETRIES) {
                    setError("Failed to generate description after multiple attempts.");
                    setIsLoading(false);
                    return;
                }
                const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }, [title, technologies, setDescription]);

    return (
        <div className="mt-2">
            <button
                type="button"
                onClick={generateProjectDescription}
                disabled={isLoading || !title || !technologies}
                className={`w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-lg transition-colors text-white font-semibold text-sm
                    ${isLoading 
                        ? 'bg-gray-600 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
            >
                {isLoading ? (
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                ) : (
                    <>
                        <span className="text-lg">✨</span>
                        <span>Draft Description with Gemini</span>
                    </>
                )}
            </button>
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        </div>
    );
};
// --- END GEMINI API INTEGRATION COMPONENT ---


const ProfileManagementPanel = ({ profile, setProfile, inputStyle }) => {
    const [currentAvatarUrl, setCurrentAvatarUrl] = useState(profile.avatarUrl);

    useEffect(() => {
        setCurrentAvatarUrl(profile.avatarUrl);
    }, [profile.avatarUrl]);

    const handleUpdateProfile = (e) => {
        e.preventDefault();
        setProfile(prev => ({
            ...prev,
            avatarUrl: currentAvatarUrl,
        }));
    };

    return (
        <div className="bg-gray-900 p-8 rounded-xl shadow-3xl mb-8 border border-gray-800">
            <h2 className="text-2xl font-extrabold text-cyan-400 mb-6">Profile Management (Manager)</h2>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
                <p className="text-gray-400 text-sm">
                    Enter the direct URL to your professional photo. This change is **not** permanent 
                    and will reset on page refresh as the profile data is managed locally.
                </p>
                <input
                    type="url"
                    placeholder="Avatar Image URL"
                    value={currentAvatarUrl}
                    onChange={(e) => setCurrentAvatarUrl(e.target.value)}
                    className={inputStyle}
                />
                <button
                    type="submit"
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-teal-500/30"
                >
                    Update Avatar
                </button>
            </form>
        </div>
    );
};


const ProjectForm = ({ addProject, updateProject, currentProject, setCurrentProject, error: dbError, inputStyle, isAppOwner }) => {
    
    // Initialize form state from currentProject or use empty strings for new project
    const isEditing = !!currentProject;
    const [id, setId] = useState(currentProject?.id || '');
    const [title, setTitle] = useState(currentProject?.title || '');
    const [description, setDescription] = useState(currentProject?.description || '');
    const [technologies, setTechnologies] = useState(currentProject?.technologies || '');
    const [githubUrl, setGithubUrl] = useState(currentProject?.githubUrl || '');
    const [liveDemoUrl, setLiveDemoUrl] = useState(currentProject?.liveDemoUrl || '');
    const [submissionError, setSubmissionError] = useState(null);

    // Effect to update form fields when a new project is selected for editing
    useEffect(() => {
        setId(currentProject?.id || '');
        setTitle(currentProject?.title || '');
        setDescription(currentProject?.description || '');
        setTechnologies(currentProject?.technologies || '');
        setGithubUrl(currentProject?.githubUrl || '');
        setLiveDemoUrl(currentProject?.liveDemoUrl || '');
        setSubmissionError(null);
    }, [currentProject]);

    const resetForm = () => {
        setCurrentProject(null);
        setId('');
        setTitle('');
        setDescription('');
        setTechnologies('');
        setGithubUrl('');
        setLiveDemoUrl('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmissionError(null);

        if (!title || !description || !technologies) {
            setSubmissionError("Title, Description, and Technologies are required.");
            return;
        }

        if (!isAppOwner) {
            setSubmissionError("SECURITY ERROR: You must be authenticated as the app owner to add/edit projects.");
            return;
        }

        const projectData = { title, description, technologies, githubUrl, liveDemoUrl };
        
        try {
            if (isEditing && id) {
                await updateProject(id, projectData);
            } else {
                await addProject(projectData);
            }
            // Clear or reset form on success
            resetForm();
        } catch (err) {
            setSubmissionError(isEditing ? "Failed to save changes." : "Failed to add project.");
        }
    };

    const panelTitle = isEditing ? `Edit Project: ${currentProject?.title}` : "Add New Project";

    return (
        <div className="bg-gray-900 p-8 rounded-xl shadow-3xl mb-12 border border-gray-800">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-extrabold text-cyan-400">{panelTitle}</h2>
                {isEditing && (
                     <button 
                        type="button"
                        onClick={resetForm}
                        className="text-gray-400 hover:text-white transition-colors text-sm font-semibold p-2 rounded-lg border border-gray-700 hover:border-white"
                     >
                        Cancel Edit
                     </button>
                )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <input
                    type="text"
                    placeholder="Project Title (e.g., MERN E-Commerce)"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={inputStyle}
                />
                <textarea
                    placeholder="Project Description"
                    rows="3"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={inputStyle}
                />
                
                {/* GEMINI INTEGRATION POINT */}
                <ProjectDraftingTool
                    title={title}
                    technologies={technologies}
                    setDescription={setDescription}
                />
                
                <input
                    type="text"
                    placeholder="Technologies (comma separated: React, Node, MySQL, PHP)"
                    value={technologies}
                    onChange={(e) => setTechnologies(e.target.value)}
                    className={inputStyle}
                />
                <input
                    type="url"
                    placeholder="GitHub Repository URL (Optional)"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    className={inputStyle}
                />
                <input
                    type="url"
                    placeholder="Live Demo URL (Optional)"
                    value={liveDemoUrl}
                    onChange={(e) => setLiveDemoUrl(e.target.value)}
                    className={inputStyle}
                />

                <button
                    type="submit"
                    className={`w-full font-bold py-3 px-4 rounded-lg transition-colors shadow-lg
                        ${isEditing 
                            ? 'bg-yellow-600 hover:bg-yellow-700 shadow-yellow-500/30 text-gray-900' 
                            : 'bg-cyan-600 hover:bg-cyan-700 shadow-cyan-500/30 text-white'
                        }`}
                >
                    {isEditing ? 'Save Changes' : 'Add Project'}
                </button>
                {(submissionError || dbError) && (
                    <p className="text-red-400 text-sm mt-2">{submissionError || dbError}</p>
                )}
            </form>
        </div>
    );
};

const TagFilter = ({ allTags, activeTag, setActiveTag }) => {
    const handleTagClick = (tag) => {
        // Toggle the active tag: clicking the active tag clears it
        setActiveTag(activeTag === tag ? null : tag);
    };

    return (
        <div className="mb-8 border-b border-gray-800 pb-4">
            <h3 className="text-lg font-semibold text-gray-300 mb-3">Filter by Technology:</h3>
            <div className="flex flex-wrap gap-3">
                {allTags.map(tag => (
                    <button
                        key={tag}
                        onClick={() => handleTagClick(tag)}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300
                            ${activeTag === tag
                                ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/30'
                                : 'bg-gray-700 text-gray-300 hover:bg-cyan-800 hover:text-white'
                            }`}
                    >
                        {tag}
                    </button>
                ))}
                   {activeTag && (
                    <button
                        onClick={() => setActiveTag(null)}
                        className="px-4 py-2 rounded-full text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-all"
                    >
                        Clear Filter
                    </button>
                )}
            </div>
        </div>
    );
};


const App = () => {
    const [isManagerMode, setIsManagerMode] = useState(false); 
    const [activeTag, setActiveTag] = useState(null); 
    const [currentProject, setCurrentProject] = useState(null); // New state to track project being edited
    
    // Auth and Data setup from the custom hook
    const { userId, isAuthReady, isAppOwner } = useSupabaseAuth();
    const { projects, addProject, updateProject, deleteProject, error, loading } = useProjects({ userId, isAuthReady });

    // Initial Profile data (now in useState to allow runtime changes)
    const initialProfile = useMemo(() => ({
        name: "Ansen G James",
        tagline: "Full-Stack Developer specializing in scalable, dynamic digital experiences.",
        about: "Hi, I'm Ansen G James — a Full-Stack Developer passionate about crafting clean, secure, and dynamic digital experiences. I specialize in the MERN stack (MongoDB, Express, React, Node.js) and have hands-on experience with Firestore for modern, scalable web applications. My journey in development also spans PHP/MySQL for robust backend systems and Java/Android for mobile app development. I enjoy exploring different technologies to create solutions that are not only functional but also deliver meaningful user experiences. When I’m not coding, you’ll find me learning new tools, improving my craft, or building something exciting that solves real-world problems.",
        email: "ansengwork@gmail.com",
        github: "https://github.com/Ansen-2255", 
        linkedin: "https://linkedin.com/in/ansen-g-james", 
        avatarUrl: "https://placehold.co/128x128/06b6d4/ffffff?text=REPLACE+WITH+YOUR+PHOTO+URL", 
    }), []);

    const [profile, setProfile] = useState(initialProfile);

    // Manager Mode is now conditional on being the Owner
    const canManage = isAuthReady && isAppOwner;

    const handleToggleManager = () => {
        if (canManage) {
            setIsManagerMode(prev => !prev);
            setCurrentProject(null); // Clear editing state when leaving Manager Mode
        } else {
            console.warn("Access Denied: Only the owner (as defined by VITE_APP_OWNER_ID) can access Manager Mode.");
        }
    };
    
    const initialLoading = !isAuthReady || loading;

    // Use a single style object for form fields for consistency
    const inputStyle = "w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-cyan-500 focus:border-cyan-500 transition-colors";

    // --- Dynamic Project Filtering Logic ---

    // 1. Extract all unique technologies for the filter buttons
    const allTags = useMemo(() => {
        const tags = new Set();
        projects.forEach(project => {
            project.technologies?.split(',').forEach(tech => {
                if (tech.trim()) tags.add(tech.trim());
            });
        });
        return Array.from(tags).sort();
    }, [projects]);

    // 2. Filter the projects based on the active tag
    const filteredProjects = useMemo(() => {
        if (!activeTag) {
            return projects;
        }
        const lowerCaseActiveTag = activeTag.toLowerCase();
        return projects.filter(project => 
            project.technologies?.toLowerCase().includes(lowerCaseActiveTag)
        );
    }, [projects, activeTag]);

    // 3. Auto-Add Initial Project Data (if missing in Supabase)
    // NOTE: We only auto-add if we are the authenticated owner
    useEffect(() => {
        if (!isAppOwner || loading || projects.length > 0) return;

        const initialProjectsData = [
            {
                title: "Movie Ticket Booking System",
                description: "Developed a robust ticketing platform featuring real-time seat availability, flexible show timing selection, and a secure booking workflow. This project highlights proficiency in full-stack web development, specifically managing transactional data integrity and delivering a highly responsive user experience. It serves as a foundational example of a high-utility, public-facing service.",
                technologies: "PHP, MySQL, JavaScript, HTML, CSS",
                githubUrl: "https://github.com/Ansen-2255/movie-booking-system",
                liveDemoUrl: "#", 
            },
            {
                title: "Applicant Tracking System (ATS)",
                description: "Developed a complete Applicant Tracking System designed to streamline the recruitment process for businesses. The platform includes essential modules for posting job openings, managing candidate registration, facilitating secure resume uploads, and providing an administrative dashboard for full oversight. This project demonstrates strong backend data management capabilities and the creation of a multi-user, role-based web utility.",
                technologies: "HTML, PHP, MySQL",
                githubUrl: "https://github.com/Ansen-2255/ATS-Applicant-Tracking-System-", 
                liveDemoUrl: "#", 
            },
            {
                title: "Hangman App",
                description: "Developed a classic Hangman word-guessing game tailored for the Android platform. This mobile application utilizes Java and Android Studio to manage game state, user input, and dynamic UI rendering based on player attempts. The project showcases practical mobile development skills, user interface design, and state management within an activity lifecycle, and fundamental game logic implementation.",
                technologies: "Android Studio, Java, Mobile Development",
                githubUrl: "https://github.com/Ansen-2255/hangman-mobile-application", 
                liveDemoUrl: "#", 
            },
        ];

        // This check ensures we only run if the projects list is empty (first time only)
        if (projects.length === 0) {
            const timer = setTimeout(() => {
                 initialProjectsData.forEach(p => addProject(p));
            }, 1500);

            return () => clearTimeout(timer);
        }
        
    }, [isAppOwner, loading, projects.length, addProject]);

    // SEO Head management
    useEffect(() => {
        document.title = `${profile.name} | Full-Stack Developer Portfolio`;
        
        const updateMeta = (name, content) => {
            let tag = document.querySelector(`meta[name="${name}"]`);
            if (!tag) {
                tag = document.createElement('meta');
                tag.name = name;
                document.head.appendChild(tag);
            }
            tag.content = content;
        };

        const updateOgMeta = (property, content) => {
            let tag = document.querySelector(`meta[property="${property}"]`);
            if (!tag) {
                tag = document.createElement('meta');
                tag.setAttribute('property', property);
                document.head.appendChild(tag);
            }
            tag.content = content;
        };

        updateMeta("description", "Ansen G James's professional portfolio showcasing full-stack MERN, PHP/MySQL, and Android development projects.");
        updateOgMeta("og:title", `${profile.name} | Full-Stack Developer Portfolio`);
        updateOgMeta("og:description", "Ansen G James's professional portfolio showcasing full-stack MERN, PHP/MySQL, and Android development projects.");
        updateOgMeta("og:url", window.location.href);
        updateOgMeta("og:type", "website");
    }, [profile.name]);


    return (
        <div className="min-h-screen bg-gray-950 text-white font-inter">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
                .font-inter { font-family: 'Inter', sans-serif; }
                /* Custom styles for aesthetic buttons */
                .neon-button {
                    box-shadow: 0 0 5px #06b6d4, 0 0 10px #06b6d4;
                }
                .shadow-3xl {
                    box-shadow: 0 10px 30px rgba(6, 182, 212, 0.4);
                }
                .whitespace-pre-wrap {
                    white-space: pre-wrap; /* Ensures line breaks in description are respected */
                }
                /* Transition for scale effect */
                .hover\\:scale-\\[1\\.03\\]:hover {
                    transform: scale(1.03);
                }
                /* Crucial fix for Tailwind visibility on Vercel */
                @tailwind base;
                @tailwind components;
                @tailwind utilities;
            `}</style>
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />

            {/* Header / Navigation */}
            <header className="bg-gray-900 shadow-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <h1 className="text-2xl font-extrabold text-cyan-400 tracking-wider">
                        {profile.name.split(' ')[0]} Portfolio
                    </h1>
                    <nav className="hidden md:flex space-x-6">
                        {['About', 'Projects', 'Contact'].map(item => (
                            <a 
                                key={item}
                                href={`#${item.toLowerCase()}`} 
                                className="text-gray-300 hover:text-cyan-400 transition-colors font-medium"
                            >
                                {item}
                            </a>
                        ))}
                    </nav>
                    {/* Toggle button for Manager Mode / Public View */}
                    {isAuthReady && (
                        <button
                            onClick={handleToggleManager}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${isManagerMode && canManage ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                        >
                            {isManagerMode ? 'Exit Manager Mode (Public View)' : 'Manager Mode'}
                        </button>
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
                
                {/* Hero Section */}
                <section id="hero" className="py-24 text-center">
                    <div className="w-32 h-32 mx-auto mb-6 flex items-center justify-center shadow-3xl">
                        {profile.avatarUrl && profile.avatarUrl.includes('http') ? (
                            <img 
                                src={profile.avatarUrl} 
                                alt={`${profile.name} Avatar`} 
                                className="w-full h-full object-cover rounded-full border-4 border-cyan-500"
                                onError={(e) => { 
                                    e.target.onerror = null; // Prevents looping
                                    // Fallback to initials if image URL fails
                                    e.target.src = `https://placehold.co/128x128/94a3b8/ffffff?text=${profile.name.charAt(0)}`;
                                    e.target.className = "w-full h-full bg-cyan-600 rounded-full flex items-center justify-center text-5xl font-bold text-white"; // Apply fallback style
                                }}
                            />
                        ) : (
                            // Fallback to initials if no valid URL is provided
                            <div className="w-full h-full bg-cyan-600 rounded-full flex items-center justify-center text-5xl font-bold text-white">
                                {profile.name.charAt(0)}
                            </div>
                        )}
                    </div>
                    <h2 className="5xl md:text-7xl font-extrabold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-teal-500">
                        {profile.name}
                    </h2>
                    <p className="text-xl text-gray-400 mb-8">{profile.tagline}</p>
                    {/* Display Owner ID only in Manager Mode for debugging */}
                    {isAuthReady && userId && isManagerMode && (
                        <div className="text-sm text-gray-500 mb-4">
                            <span className="font-bold text-cyan-500">USER ID: </span>
                            <span className="break-all">{userId}</span>
                        </div>
                    )}
                    <a 
                        href="#projects"
                        className="inline-block px-8 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg text-lg transition-transform transform hover:scale-105 neon-button"
                    >
                        View Projects
                    </a>
                </section>

                {/* About Section */}
                <section id="about" className="py-20 border-t border-gray-800">
                    <h2 className="text-4xl font-bold text-white mb-8 text-center">About Me</h2>
                    <div className="max-w-4xl mx-auto bg-gray-900 p-8 rounded-xl shadow-2xl border border-gray-800">
                        <p className="text-gray-400 leading-relaxed">{profile.about}</p>
                        <div className="mt-8 grid grid-cols-2 gap-4 text-sm font-medium">
                            <p><span className="text-cyan-400">Stack:</span> MERN (MongoDB, Express, React, Node.js)</p>
                            <p><span className="text-cyan-400">Frontend:</span> React, Tailwind CSS</p>
                            <p><span className="text-cyan-400">Backend:</span> Node.js, Express.js</p>
                            <p><span className="text-cyan-400">Database:</span> Supabase (for this demo's persistent storage)</p>
                        </div>
                    </div>
                </section>

                {/* Projects Section */}
                <section id="projects" className="py-20 border-t border-gray-800">
                    <h2 className="text-4xl font-bold text-white mb-12 text-center">My Projects</h2>

                    {/* Manager Panels (Conditionally rendered) */}
                    {isManagerMode && canManage && (
                        <>
                            <ProfileManagementPanel 
                                profile={profile} 
                                setProfile={setProfile}
                                inputStyle={inputStyle} 
                            />
                            <ProjectForm 
                                addProject={addProject} 
                                updateProject={updateProject} 
                                currentProject={currentProject}
                                setCurrentProject={setCurrentProject}
                                error={error}
                                inputStyle={inputStyle}
                                isAppOwner={isAppOwner}
                            />
                        </>
                    )}
                    {isManagerMode && !canManage && (
                        <div className="text-center p-8 text-red-400 border border-red-500/30 bg-red-900/10 rounded-lg mb-12">
                            Access Denied: Only the owner (ID: {VERCEL_OWNER_ID}) can manage projects.
                        </div>
                    )}


                    {/* Project List */}
                    {initialLoading && (
                        <div className="text-center p-8 text-gray-400">Loading projects...</div>
                    )}

                    {!initialLoading && error && (
                        <div className="text-center p-8 text-red-400 border border-red-500/30 bg-red-900/10 rounded-lg">
                            Error: {error}
                        </div>
                    )}

                    {!initialLoading && !error && projects.length > 0 && (
                        <TagFilter 
                            allTags={allTags}
                            activeTag={activeTag}
                            setActiveTag={setActiveTag}
                        />
                    )}
                    
                    {!initialLoading && !error && filteredProjects.length === 0 && (
                        <div className="text-center p-8 text-gray-500">
                            {activeTag ? 'No projects match the selected filter.' : 'No projects found in the database. Add one now!'}
                        </div>
                    )}


                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {filteredProjects.map(project => (
                            <ProjectCard 
                                key={project.id} 
                                project={project} 
                                onDelete={deleteProject} 
                                onEdit={setCurrentProject} // Passed setter for edit state
                                isManagerMode={isManagerMode} 
                            />
                        ))}
                    </div>
                </section>
                
                {/* Contact Section */}
                <section id="contact" className="py-20 border-t border-gray-800">
                    <h2 className="text-4xl font-bold text-white mb-8 text-center">Get In Touch</h2>
                    <div className="max-w-2xl mx-auto bg-gray-900 p-8 rounded-xl shadow-2xl border border-gray-800 text-center">
                        <p className="text-gray-400 mb-6">
                            I'm currently available for new opportunities. Feel free to reach out!
                        </p>
                        <a 
                            href={`mailto:${profile.email}`}
                            className="inline-block px-8 py-3 mb-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg text-lg transition-transform transform hover:scale-105"
                        >
                            Email Me: {profile.email}
                        </a>
                        <p className="text-gray-500 mt-4 space-x-6 flex justify-center">
                            {/* GitHub Link with Icon */}
                            <span className="flex items-center space-x-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.542-1.361-1.329-1.725-1.329-1.725-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.303.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.046.138 3.003.404 2.292-1.552 3.3-1.23 3.3-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.785 24 17.306 24 12 24 5.373 18.627 0 12 0z"/></svg>
                                <a href={profile.github} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 transition-colors">github.com/Ansen-2255</a>
                            </span>
                            
                            {/* LinkedIn Link with Icon */}
                            <span className="flex items-center space-x-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5c0 1.381-1.11 2.5-2.48 2.5s-2.48-1.119-2.48-2.5c0-1.381 1.11-2.5 2.48-2.5s2.48 1.119 2.48 2.5zm.02 4.5h-5v16h5v-16zm7.982 0h-4.968v16h4.969v-8.399c0-4.67 6.029-4.759 6.029 0v8.399h4.988v-10.133c0-7.203-9.282-7.05-11.054-3.552v-2.478z"/></svg>
                                <a href={profile.linkedin} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 transition-colors">linkedin.com/in/ansen-g-james</a>
                            </span>
                        </p>
                    </div>
                </section>

            </main>

            {/* Footer */}
            <footer className="bg-gray-900 mt-12 py-8 border-t border-gray-800 text-center text-gray-500">
                <p>&copy; {new Date().getFullYear()} {profile.name}. Built with React & MERN principles (using Supabase for persistence).</p>
            </footer>
        </div>
    );
};

export default App;
