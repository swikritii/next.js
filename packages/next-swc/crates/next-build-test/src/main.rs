#![feature(future_join)]
#![feature(min_specialization)]
#![feature(arbitrary_self_types)]

use anyhow::Result;
use next_api::{
    project::{ProjectContainer, ProjectOptions},
    route::{Endpoint, Route},
};
use turbo_tasks::TurboTasks;
use turbo_tasks_malloc::TurboMalloc;
use turbopack_binding::turbo::tasks_memory::MemoryBackend;

#[global_allocator]
static ALLOC: turbo_tasks_malloc::TurboMalloc = turbo_tasks_malloc::TurboMalloc;

fn main() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .on_thread_stop(|| {
            TurboMalloc::thread_stop();
        })
        .build()
        .unwrap()
        .block_on(async {
            let tt = TurboTasks::new(MemoryBackend::new(usize::MAX));
            tt.run_once(main_inner()).await
        })
        .unwrap();
}

async fn main_inner() -> Result<()> {
    register();

    let mut file = std::fs::File::open("project_options.json")?;
    let data: ProjectOptions = serde_json::from_reader(&mut file).unwrap();

    let options = ProjectOptions { ..data };

    let project = ProjectContainer::new(options);

    let entrypoints = project.entrypoints().await?;

    // TODO run 10 in parallel
    // select 100 by pseudo random
    let routes = entrypoints
        .routes
        .iter()
        .filter(|(name, _)| name.contains("home"))
        .collect::<Vec<_>>();
    for (name, route) in routes {
        println!("{name}");
        match route {
            Route::Page {
                html_endpoint,
                data_endpoint: _,
            } => {
                html_endpoint.write_to_disk().await?;
            }
            Route::PageApi { endpoint } => {
                endpoint.write_to_disk().await?;
            }
            Route::AppPage(routes) => {
                for route in routes {
                    route.html_endpoint.write_to_disk().await?;
                }
            }
            Route::AppRoute {
                original_name: _,
                endpoint,
            } => {
                endpoint.write_to_disk().await?;
            }
            Route::Conflict => {
                println!("WARN: conflict {}", name);
            }
        }
    }

    Ok(())
}

fn register() {
    next_api::register();
    include!(concat!(env!("OUT_DIR"), "/register.rs"));
}
